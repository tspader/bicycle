#define SP_IMPLEMENTATION
#include "sp.h"

#include <alpm.h>
#include <alpm_list.h>
#include <archive.h>
#include <archive_entry.h>
#include "sqlite3.h"

#include "sql/schema.h"
#include "sql/pragma.h"
#include "sql/file_metadata.h"
#include "sql/mtree.h"
#include "sql/meta_run.h"

#define bc_alpm_for(it, list) for (alpm_list_t* it = list; it; it = alpm_list_next(it))

#define BC_NUM_WORKERS       8
#define BC_ARENA_BLOCK_SIZE  (4u * 1024u * 1024u)
#define BC_QUEUE_CAPACITY    4096u
#define BC_WRITE_BATCH       1024u

typedef enum {
  BC_OK,
  BC_ERR,
  BC_ERR_SQLITE_EXEC,
  BC_ERR_SQLITE_PREPARE,
} bc_err_t;

typedef struct {
  u64 dev;
  u64 ino;
} bc_file_key_t;

typedef struct {
  s64 mtime_sec;
  s64 mtime_nsec;
  s64 ctime_sec;
  s64 ctime_nsec;
  s64 size;
  u8  sha256 [32];
} bc_file_meta_t;

typedef sp_ht(bc_file_key_t, bc_file_meta_t) bc_fmeta_ht_t;

typedef struct {
  sp_str_t pkg;
  sp_str_t path;
  sp_fs_kind_t kind;
  s64      size;
  s32      mode;
  s32      uid;
  s32      gid;
  s64      mtime;
  u8       sha256 [32];
  bool     have_hash;
  sp_str_t target;
} bc_mtree_entry_t;

typedef sp_str_ht(bc_mtree_entry_t) bc_mtree_ht_t;

// Work items are just borrowed string slices into bc->work.arena. The arena
// is a plain bump allocator owned by bc_t, populated by the producer before
// workers spawn (well, concurrently with their consumption) and torn down
// only after every worker has joined.
typedef sp_str_t bc_work_t;

typedef enum {
  BC_WRITE_FILE = 1,
} bc_write_kind_t;

typedef struct {
  bc_file_key_t  key;
  bc_file_meta_t meta;
  sp_str_t       path;
} bc_write_file_t;

typedef struct {
  bc_write_kind_t kind;
  union {
    bc_write_file_t file;
  };
} bc_write_t;

//
// Generic blocking queue: mutex + cv around an sp_rb of T. Capacity lives on
// the ring buffer, so there's only one source of truth.
//

#define bc_queue(T) struct { \
  sp_mutex_t mu;             \
  sp_cv_t    not_empty;      \
  sp_cv_t    not_full;       \
  bool       closed;         \
  sp_rb(T)   rb;             \
}

#define bc_queue_init(mem, q, cap) do {            \
  sp_mutex_init(&(q)->mu, SP_MUTEX_PLAIN);         \
  sp_cv_init(&(q)->not_empty);                     \
  sp_cv_init(&(q)->not_full);                      \
  (q)->closed = false;                             \
  sp_rb_init_cap((mem), (q)->rb, (cap));           \
} while (0)

#define bc_queue_push(q, item) do {                                  \
  sp_mutex_lock(&(q)->mu);                                           \
  while (sp_rb_size((q)->rb) >= sp_rb_capacity((q)->rb)) {           \
    sp_cv_wait(&(q)->not_full, &(q)->mu);                            \
  }                                                                  \
  sp_rb_push((q)->rb, (item));                                       \
  sp_cv_notify_one(&(q)->not_empty);                                 \
  sp_mutex_unlock(&(q)->mu);                                         \
} while (0)

// true if an item was popped into *out; false if the queue is closed and
// drained.
#define bc_queue_pop(q, out) __extension__ ({                        \
  bool _ok = false;                                                  \
  sp_mutex_lock(&(q)->mu);                                           \
  while (sp_rb_empty((q)->rb) && !(q)->closed) {                     \
    sp_cv_wait(&(q)->not_empty, &(q)->mu);                           \
  }                                                                  \
  if (!sp_rb_empty((q)->rb)) {                                       \
    *(out) = *sp_rb_peek((q)->rb);                                   \
    sp_rb_pop((q)->rb);                                              \
    sp_cv_notify_one(&(q)->not_full);                                \
    _ok = true;                                                      \
  }                                                                  \
  sp_mutex_unlock(&(q)->mu);                                         \
  _ok;                                                               \
})

#define bc_queue_close(q) do {                                       \
  sp_mutex_lock(&(q)->mu);                                           \
  (q)->closed = true;                                                \
  sp_cv_notify_all(&(q)->not_empty);                                 \
  sp_mutex_unlock(&(q)->mu);                                         \
} while (0)

typedef bc_queue(bc_work_t)  bc_work_queue_t;
typedef bc_queue(bc_write_t) bc_write_queue_t;

typedef struct {
  sp_str_t root;
  sp_str_t db;
  sp_str_t cache;
} bc_paths_t;

typedef struct bc_t bc_t;

typedef struct {
  bc_t*           bc;
  u32             id;
  sp_thread_t     thread;
  sp_mem_arena_t* arena;
  u64             hits;
  u64             misses;
  u64             errors;
} bc_worker_t;

typedef struct {
  bc_t*       bc;
  sqlite3*    sql;
  sp_thread_t thread;
  u64         writes;
  bc_err_t    err;
} bc_writer_t;

struct bc_t {
  sp_mem_t mem;
  alpm_handle_t* alpm;
  sqlite3* sql;
  bc_paths_t paths;
  u64 num_packages;
  u64 num_files;
  u64 run_id;

  // Loaded once from the db on startup and read-only for the rest of the run.
  // Workers read via sp_ht_get_ex, which doesn't touch the table's tmp slots,
  // so no locking is needed.
  bc_fmeta_ht_t files;

  struct {
    bc_mtree_ht_t   ht;
    sp_mem_arena_t* arena;
    u64             decoded;
    u64             cached;
    u64             entries;
  } mtree;

  struct {
    bc_work_queue_t queue;
    sp_mem_arena_t* arena;  // bump arena backing every work item's path
  } work;

  bc_write_queue_t write;

  bc_worker_t workers [BC_NUM_WORKERS];
  bc_writer_t writer;

  struct {
    u64 mtree;
    u64 files;
    u64 total;
  } timings;
};

//
// SQLite error helpers
//

bc_err_t bc_check_sql(sqlite3* sql, s32 rc) {
  if (rc != SQLITE_OK && rc != SQLITE_DONE && rc != SQLITE_ROW) {
    sp_log_err("sqlite error: {.red} (code {})", sp_fmt_cstr(sqlite3_errmsg(sql)), sp_fmt_int(rc));
    return BC_ERR;
  }
  return BC_OK;
}

bc_err_t bc_sql_exec(sqlite3* sql, const c8* statement) {
  c8* err = SP_NULLPTR;
  s32 rc = sqlite3_exec(sql, statement, SP_NULLPTR, SP_NULLPTR, &err);
  if (rc != SQLITE_OK) {
    sp_log_err("sqlite exec failed: {.red}", sp_fmt_cstr(err ? err : "(no message)"));
    sqlite3_free(err);
    return BC_ERR_SQLITE_EXEC;
  }
  return BC_OK;
}

bc_err_t bc_db_open_conn(sp_str_t path, sqlite3** out) {
  sp_mem_arena_marker_t scratch = sp_mem_begin_scratch();
  c8* cpath = sp_str_to_cstr(sp_mem_arena_as_allocator(sp_mem_get_scratch_arena()), path);
  s32 rc = sqlite3_open(cpath, out);
  sp_mem_end_scratch(scratch);
  sp_try(bc_check_sql(*out, rc));
  sp_try(bc_sql_exec(*out, bc_db_pragmas));
  return BC_OK;
}

bc_err_t bc_db_open(bc_t* bc) {
  sp_try(bc_db_open_conn(bc->paths.cache, &bc->sql));
  sp_try(bc_sql_exec(bc->sql, bc_db_schema));
  return BC_OK;
}

bc_err_t bc_alpm_open(bc_t* bc) {
  sp_mem_arena_marker_t scratch = sp_mem_begin_scratch();
  sp_mem_t scratch_mem = sp_mem_arena_as_allocator(sp_mem_get_scratch_arena());
  c8* root = sp_str_to_cstr(scratch_mem, bc->paths.root);
  c8* db   = sp_str_to_cstr(scratch_mem, bc->paths.db);

  alpm_errno_t err = 0;
  bc->alpm = alpm_initialize(root, db, &err);
  sp_mem_end_scratch(scratch);
  if (err || !bc->alpm) {
    sp_log_err("alpm_initialize failed: {} ({})", sp_fmt_cstr(alpm_strerror(err)), sp_fmt_int(err));
    return BC_ERR;
  }
  return BC_OK;
}

//
// In-memory file metadata cache
//

bc_err_t bc_fmeta_load(bc_t* bc) {
  sqlite3_stmt* stmt = SP_NULLPTR;
  sp_try(bc_check_sql(bc->sql, sqlite3_prepare_v2(bc->sql, bc_db_select_file_metadata, -1, &stmt, SP_NULLPTR)));

  u64 loaded = 0;
  s32 rc;
  while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
    bc_file_key_t  k = sp_zero;
    bc_file_meta_t m = sp_zero;
    k.dev        = (u64)sqlite3_column_int64(stmt, 0);
    k.ino        = (u64)sqlite3_column_int64(stmt, 1);
    m.mtime_sec  = sqlite3_column_int64(stmt, 2);
    m.mtime_nsec = sqlite3_column_int64(stmt, 3);
    m.ctime_sec  = sqlite3_column_int64(stmt, 4);
    m.ctime_nsec = sqlite3_column_int64(stmt, 5);
    m.size       = sqlite3_column_int64(stmt, 6);
    const void* blob = sqlite3_column_blob(stmt, 7);
    s32 blob_len = sqlite3_column_bytes(stmt, 7);
    if (blob && blob_len == 32) {
      sp_mem_copy(m.sha256, blob, 32);
    }
    sp_ht_insert(bc->files, k, m);
    loaded++;
  }
  bc_err_t err = bc_check_sql(bc->sql, rc);
  sqlite3_finalize(stmt);
  sp_try(err);

  sp_log("{:<12} {.cyan}", sp_fmt_cstr("loaded:"), sp_fmt_uint(loaded));
  return BC_OK;
}

//
// Worker thread: pop path, lstat, compare against the cache, emit a write on miss.
//

s32 bc_worker_fn(void* userdata) {
  bc_worker_t* w = (bc_worker_t*)userdata;
  bc_t* bc = w->bc;
  sp_mem_t arena_mem = sp_mem_arena_as_allocator(w->arena);

  bc_work_t path;
  while (bc_queue_pop(&bc->work.queue, &path)) {
    sp_sys_stat_t st = sp_zero;
    if (sp_sys_lstat_s(path, &st) != 0) {
      w->errors++;
      continue;
    }
    if (st.kind != SP_FS_KIND_FILE) continue;

    bc_file_key_t key = { .dev = st.device, .ino = st.id };
    u64 idx;
    bc_file_meta_t* hit = sp_ht_get_ex(bc->files, key, idx);
    if (hit
        && hit->mtime_sec  == st.mtime.tv_sec
        && hit->mtime_nsec == st.mtime.tv_nsec
        && hit->ctime_sec  == st.btime.tv_sec
        && hit->ctime_nsec == st.btime.tv_nsec
        && hit->size       == st.size) {
      w->hits++;
      continue;
    }
    w->misses++;

    bc_write_t out = sp_zero;
    out.kind                 = BC_WRITE_FILE;
    out.file.key             = key;
    out.file.meta.mtime_sec  = st.mtime.tv_sec;
    out.file.meta.mtime_nsec = st.mtime.tv_nsec;
    out.file.meta.ctime_sec  = st.btime.tv_sec;
    out.file.meta.ctime_nsec = st.btime.tv_nsec;
    out.file.meta.size       = st.size;
    out.file.path = sp_str_copy(arena_mem, path);

    bc_queue_push(&bc->write, out);
  }
  return BC_OK;
}

//
// Writer thread: batch upserts into file_metadata on its own sqlite connection.
//

#define bc_writer_try(expr) sp_try_goto((expr), w->err, done)

s32 bc_writer_fn(void* userdata) {
  bc_writer_t* w = (bc_writer_t*)userdata;

  sqlite3_stmt* upsert = SP_NULLPTR;
  bool in_tx = false;
  u32  in_batch = 0;
  u8   zero_hash [32] = sp_zero;

  bc_writer_try(bc_check_sql(w->sql, sqlite3_prepare_v2(w->sql, bc_db_upsert_file_metadata, -1, &upsert, SP_NULLPTR)));

  bc_write_t item;
  while (bc_queue_pop(&w->bc->write, &item)) {
    if (!in_tx) {
      bc_writer_try(bc_sql_exec(w->sql, "BEGIN;"));
      in_tx = true;
      in_batch = 0;
    }

    sqlite3_reset(upsert);
    sqlite3_bind_int64(upsert,  1, (s64)item.file.key.dev);
    sqlite3_bind_int64(upsert,  2, (s64)item.file.key.ino);
    sqlite3_bind_int64(upsert,  3, item.file.meta.mtime_sec);
    sqlite3_bind_int64(upsert,  4, item.file.meta.mtime_nsec);
    sqlite3_bind_int64(upsert,  5, item.file.meta.ctime_sec);
    sqlite3_bind_int64(upsert,  6, item.file.meta.ctime_nsec);
    sqlite3_bind_int64(upsert,  7, item.file.meta.size);
    sqlite3_bind_blob (upsert,  8, zero_hash, 32, SQLITE_STATIC);
    sqlite3_bind_text (upsert,  9, item.file.path.data, (s32)item.file.path.len, SQLITE_STATIC);
    sqlite3_bind_int64(upsert, 10, (s64)w->bc->run_id);

    bc_writer_try(bc_check_sql(w->sql, sqlite3_step(upsert)));
    w->writes++;
    in_batch++;

    if (in_batch >= BC_WRITE_BATCH) {
      bc_writer_try(bc_sql_exec(w->sql, "COMMIT;"));
      in_tx = false;
    }
  }

  if (in_tx) {
    bc_writer_try(bc_sql_exec(w->sql, "COMMIT;"));
    in_tx = false;
  }

done:
  if (in_tx) bc_sql_exec(w->sql, "ROLLBACK;");
  sqlite3_finalize(upsert);
  return w->err;
}

//
// Run-metadata bookkeeping
//

bc_err_t bc_run_begin(bc_t* bc, sp_str_t action) {
  sqlite3_stmt* stmt = SP_NULLPTR;
  sp_try(bc_check_sql(bc->sql, sqlite3_prepare_v2(bc->sql, bc_db_insert_meta_run, -1, &stmt, SP_NULLPTR)));

  sp_tm_epoch_t now = sp_tm_now_epoch();
  sqlite3_bind_int64(stmt, 1, (s64)now.s);
  sqlite3_bind_text (stmt, 2, action.data, (s32)action.len, SQLITE_STATIC);
  sqlite3_bind_null (stmt, 3);

  bc_err_t err = bc_check_sql(bc->sql, sqlite3_step(stmt));
  sqlite3_finalize(stmt);
  sp_try(err);

  bc->run_id = (u64)sqlite3_last_insert_rowid(bc->sql);
  return BC_OK;
}

bc_err_t bc_run_end(bc_t* bc, u64 elapsed_ns) {
  sqlite3_stmt* stmt = SP_NULLPTR;
  sp_try(bc_check_sql(bc->sql, sqlite3_prepare_v2(bc->sql, bc_db_update_meta_run_elapsed, -1, &stmt, SP_NULLPTR)));

  sqlite3_bind_double(stmt, 1, (f64)elapsed_ns);
  sqlite3_bind_int64 (stmt, 2, (s64)bc->run_id);

  bc_err_t err = bc_check_sql(bc->sql, sqlite3_step(stmt));
  sqlite3_finalize(stmt);
  return err;
}

//
// Mtree cache (decode-or-load per installed package)
//

sp_fs_kind_t bc_mtree_kind_from_archive(s32 ft) {
  if (ft == AE_IFREG) return SP_FS_KIND_FILE;
  if (ft == AE_IFDIR) return SP_FS_KIND_DIR;
  if (ft == AE_IFLNK) return SP_FS_KIND_SYMLINK;
  return SP_FS_KIND_NONE;
}

bc_err_t bc_mtree_disk_mtime(bc_t* bc, sp_str_t local_dir, s64* out_mtime) {
  (void)bc;
  sp_sys_stat_t st = sp_zero;
  if (sp_sys_lstat_s(local_dir, &st) != 0) return BC_ERR;
  *out_mtime = st.mtime.tv_sec;
  return BC_OK;
}

bc_err_t bc_mtree_load_entries(bc_t* bc, sp_str_t pkg) {
  sp_mem_t arena_mem = sp_mem_arena_as_allocator(bc->mtree.arena);

  sqlite3_stmt* stmt = SP_NULLPTR;
  sp_try(bc_check_sql(bc->sql, sqlite3_prepare_v2(bc->sql, bc_db_select_mtree_entries, -1, &stmt, SP_NULLPTR)));
  sqlite3_bind_text(stmt, 1, pkg.data, (s32)pkg.len, SQLITE_STATIC);

  s32 rc;
  while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
    bc_mtree_entry_t e = sp_zero;
    e.pkg = pkg;

    sp_str_t path = (sp_str_t){
      .data = (const c8*)sqlite3_column_text(stmt, 0),
      .len  = (u32)sqlite3_column_bytes(stmt, 0),
    };
    e.path  = sp_str_copy(arena_mem, path);
    e.kind  = (sp_fs_kind_t)sqlite3_column_int(stmt, 1);
    e.size  = sqlite3_column_int64(stmt, 2);
    e.mode  = sqlite3_column_int  (stmt, 3);
    e.uid   = sqlite3_column_int  (stmt, 4);
    e.gid   = sqlite3_column_int  (stmt, 5);
    e.mtime = sqlite3_column_int64(stmt, 6);

    const void* blob = sqlite3_column_blob (stmt, 7);
    s32 blob_len     = sqlite3_column_bytes(stmt, 7);
    if (blob && blob_len == 32) {
      sp_mem_copy(e.sha256, blob, 32);
      e.have_hash = true;
    }
    if (sqlite3_column_type(stmt, 8) != SQLITE_NULL) {
      sp_str_t target = (sp_str_t){
        .data = (const c8*)sqlite3_column_text(stmt, 8),
        .len  = (u32)sqlite3_column_bytes(stmt, 8),
      };
      e.target = sp_str_copy(arena_mem, target);
    }

    sp_str_ht_insert(bc->mtree.ht, e.path, e);
    bc->mtree.entries++;
  }
  bc_err_t err = bc_check_sql(bc->sql, rc);
  sqlite3_finalize(stmt);
  return err;
}

bc_err_t bc_mtree_decode(bc_t* bc, sp_str_t pkg, sp_str_t version, s64 mtree_mtime, sp_str_t mtree_path) {
  sp_mem_t arena_mem = sp_mem_arena_as_allocator(bc->mtree.arena);
  bc_err_t err = BC_OK;
  bool in_tx = false;

  sp_mem_arena_marker_t scratch = sp_mem_begin_scratch();
  c8* mtree_path_c = sp_str_to_cstr(sp_mem_arena_as_allocator(sp_mem_get_scratch_arena()), mtree_path);

  struct archive* a = archive_read_new();
  archive_read_support_filter_gzip(a);
  archive_read_support_format_mtree(a);
  sqlite3_stmt* del_entries = SP_NULLPTR;
  sqlite3_stmt* ins_entry   = SP_NULLPTR;
  sqlite3_stmt* ups_mtree   = SP_NULLPTR;

  if (archive_read_open_filename(a, mtree_path_c, 8192) != ARCHIVE_OK) {
    sp_log_err("archive_read_open_filename {.red}: {}", sp_fmt_str(mtree_path), sp_fmt_cstr(archive_error_string(a)));
    err = BC_ERR;
    goto done;
  }

  sp_try_goto(bc_check_sql(bc->sql, sqlite3_prepare_v2(bc->sql, bc_db_delete_mtree_entries, -1, &del_entries, SP_NULLPTR)), err, done);
  sp_try_goto(bc_check_sql(bc->sql, sqlite3_prepare_v2(bc->sql, bc_db_insert_mtree_entry,   -1, &ins_entry,   SP_NULLPTR)), err, done);
  sp_try_goto(bc_check_sql(bc->sql, sqlite3_prepare_v2(bc->sql, bc_db_upsert_mtree,         -1, &ups_mtree,   SP_NULLPTR)), err, done);

  sp_try_goto(bc_sql_exec(bc->sql, "BEGIN;"), err, done);
  in_tx = true;

  sqlite3_bind_text (ups_mtree, 1, pkg.data,     (s32)pkg.len,     SQLITE_STATIC);
  sqlite3_bind_text (ups_mtree, 2, version.data, (s32)version.len, SQLITE_STATIC);
  sqlite3_bind_int64(ups_mtree, 3, mtree_mtime);
  sp_try_goto(bc_check_sql(bc->sql, sqlite3_step(ups_mtree)), err, done);

  sqlite3_bind_text(del_entries, 1, pkg.data, (s32)pkg.len, SQLITE_STATIC);
  sp_try_goto(bc_check_sql(bc->sql, sqlite3_step(del_entries)), err, done);

  struct archive_entry* ae = SP_NULLPTR;
  s32 ar;
  while ((ar = archive_read_next_header(a, &ae)) == ARCHIVE_OK) {
    sp_str_t rel = sp_cstr_as_str(archive_entry_pathname(ae));
    // Skip mtree metadata entries like .BUILDINFO, .PKGINFO, .MTREE.
    if (rel.len >= 3 && rel.data[0] == '.' && rel.data[1] == '/' && rel.data[2] == '.') continue;
    if (rel.len >= 1 && rel.data[0] == '.' && rel.len > 1 && rel.data[1] != '/') continue;

    bc_mtree_entry_t e = sp_zero;
    e.pkg   = pkg;
    e.path  = sp_fs_join_path(arena_mem, bc->paths.root, sp_str_strip_left(rel, sp_str_lit("./")));
    e.kind  = bc_mtree_kind_from_archive((s32)archive_entry_filetype(ae));
    e.size  = (s64)archive_entry_size(ae);
    e.mode  = (s32)(archive_entry_mode(ae) & 07777);
    e.uid   = (s32)archive_entry_uid(ae);
    e.gid   = (s32)archive_entry_gid(ae);
    e.mtime = (s64)archive_entry_mtime(ae);

    const u8* digest = archive_entry_digest(ae, ARCHIVE_ENTRY_DIGEST_SHA256);
    if (digest) {
      sp_mem_copy(e.sha256, digest, 32);
      e.have_hash = true;
    }
    if (e.kind == SP_FS_KIND_SYMLINK) {
      const c8* tgt = archive_entry_symlink(ae);
      if (tgt) e.target = sp_str_copy(arena_mem, sp_cstr_as_str(tgt));
    }

    sp_str_ht_insert(bc->mtree.ht, e.path, e);
    bc->mtree.entries++;

    sqlite3_reset(ins_entry);
    sqlite3_bind_text (ins_entry,  1, pkg.data,    (s32)pkg.len,    SQLITE_STATIC);
    sqlite3_bind_text (ins_entry,  2, e.path.data, (s32)e.path.len, SQLITE_STATIC);
    sqlite3_bind_int  (ins_entry,  3, (s32)e.kind);
    sqlite3_bind_int64(ins_entry,  4, e.size);
    sqlite3_bind_int  (ins_entry,  5, e.mode);
    sqlite3_bind_int  (ins_entry,  6, e.uid);
    sqlite3_bind_int  (ins_entry,  7, e.gid);
    sqlite3_bind_int64(ins_entry,  8, e.mtime);
    if (e.have_hash) sqlite3_bind_blob(ins_entry, 9, e.sha256, 32, SQLITE_STATIC);
    else             sqlite3_bind_null(ins_entry, 9);
    if (e.target.len) sqlite3_bind_text(ins_entry, 10, e.target.data, (s32)e.target.len, SQLITE_STATIC);
    else              sqlite3_bind_null(ins_entry, 10);
    sp_try_goto(bc_check_sql(bc->sql, sqlite3_step(ins_entry)), err, done);
  }
  if (ar != ARCHIVE_EOF) {
    sp_log_err("mtree decode {.red}: {}", sp_fmt_str(mtree_path), sp_fmt_cstr(archive_error_string(a)));
    err = BC_ERR;
    goto done;
  }

  sp_try_goto(bc_sql_exec(bc->sql, "COMMIT;"), err, done);
  in_tx = false;

done:
  if (in_tx) bc_sql_exec(bc->sql, "ROLLBACK;");
  if (del_entries) sqlite3_finalize(del_entries);
  if (ins_entry)   sqlite3_finalize(ins_entry);
  if (ups_mtree)   sqlite3_finalize(ups_mtree);
  archive_read_free(a);
  sp_mem_end_scratch(scratch);
  return err;
}

bc_err_t bc_mtree_load(bc_t* bc) {
  sp_mem_t arena_mem = sp_mem_arena_as_allocator(bc->mtree.arena);

  sqlite3_stmt* sel = SP_NULLPTR;
  bc_err_t err = bc_check_sql(bc->sql, sqlite3_prepare_v2(bc->sql, bc_db_select_mtree, -1, &sel, SP_NULLPTR));
  if (err) goto done;

  alpm_db_t* local = alpm_get_localdb(bc->alpm);
  alpm_list_t* cache = alpm_db_get_pkgcache(local);

  bc_alpm_for(it, cache) {
    alpm_pkg_t* pkg_h = it->data;
    sp_str_t pkg     = sp_str_copy(arena_mem, sp_cstr_as_str(alpm_pkg_get_name(pkg_h)));
    sp_str_t version = sp_str_copy(arena_mem, sp_cstr_as_str(alpm_pkg_get_version(pkg_h)));

    sp_str_t local_dir  = sp_fs_join_path(arena_mem, bc->paths.db, sp_fmt(arena_mem, "local/{}-{}", sp_fmt_str(pkg), sp_fmt_str(version)).value);
    sp_str_t mtree_path = sp_fs_join_path(arena_mem, local_dir, sp_str_lit("mtree"));

    s64 disk_mtime = 0;
    if (bc_mtree_disk_mtime(bc, mtree_path, &disk_mtime) != BC_OK) continue;

    sqlite3_reset(sel);
    sqlite3_bind_text(sel, 1, pkg.data, (s32)pkg.len, SQLITE_STATIC);
    s32 rc = sqlite3_step(sel);
    bool hit = false;
    if (rc == SQLITE_ROW) {
      sp_str_t db_version = (sp_str_t){
        .data = (const c8*)sqlite3_column_text(sel, 0),
        .len  = (u32)sqlite3_column_bytes(sel, 0),
      };
      s64 db_mtime = sqlite3_column_int64(sel, 1);
      hit = (db_mtime == disk_mtime) && sp_str_equal(db_version, version);
    } else {
      err = bc_check_sql(bc->sql, rc);
      if (err) goto done;
    }

    if (hit) {
      err = bc_mtree_load_entries(bc, pkg);
      if (err) goto done;
      bc->mtree.cached++;
    } else {
      err = bc_mtree_decode(bc, pkg, version, disk_mtime, mtree_path);
      if (err) goto done;
      bc->mtree.decoded++;
    }
  }

done:
  sqlite3_finalize(sel);
  return err;
}

//
// Producer: walk every libalpm-owned file, enqueue into the work queue.
//

void bc_enqueue_owned_files(bc_t* bc) {
  sp_mem_t arena_mem = sp_mem_arena_as_allocator(bc->work.arena);
  alpm_db_t* local = alpm_get_localdb(bc->alpm);
  alpm_list_t* cache = alpm_db_get_pkgcache(local);
  bc->num_packages = alpm_list_count(cache);

  bc_alpm_for(it, cache) {
    alpm_pkg_t* pkg = it->data;
    alpm_filelist_t* files = alpm_pkg_get_files(pkg);
    if (!files) continue;
    for (u64 i = 0; i < files->count; i++) {
      const c8* name = files->files[i].name;
      if (!name) continue;

      sp_str_t name_view = sp_cstr_as_str(name);
      sp_str_t abs = sp_fs_join_path(arena_mem, bc->paths.root, name_view);
      // alpm directory entries end with '/'; sp_fs_join_path already strips
      // them, so abs is clean.
      if (sp_str_empty(abs)) continue;

      bc->num_files++;
      bc_queue_push(&bc->work.queue, abs);
    }
  }
}

s32 main(s32 num_args, const c8** args) {
  (void)num_args; (void)args;
  sp_mem_t mem = sp_mem_os_new();

  bc_t bc = sp_zero;
  bc.mem = mem;
  bc.paths.root = sp_str_lit("/");
  bc.paths.db = sp_str_lit("/var/lib/pacman");
  bc.paths.cache = sp_os_env_get(sp_str_lit("BC_DB"));
  if (sp_str_empty(bc.paths.cache)) {
    sp_str_t cache_dir = sp_fs_join_path(mem, sp_fs_get_cwd(mem), sp_str_lit(".cache"));
    sp_fs_create_dir(cache_dir);
    bc.paths.cache = sp_fs_join_path(mem, cache_dir, sp_str_lit("bicycle.db"));
  }

  sp_log("{:<12} {.cyan}", sp_fmt_cstr("libalpm:"), sp_fmt_cstr(alpm_version()));
  sp_log("{:<12} {.cyan}", sp_fmt_cstr("sqlite:"),  sp_fmt_cstr(sqlite3_libversion()));
  sp_log("{:<12} {.cyan}", sp_fmt_cstr("cache:"),   sp_fmt_str(bc.paths.cache));

  sp_try(bc_db_open(&bc));
  sp_try(bc_alpm_open(&bc));

  // In-memory file metadata cache, loaded once. Workers read concurrently
  // via sp_ht_get_ex (no shared tmp state), so no mutex.
  sp_ht_init(mem, bc.files);
  sp_try(bc_fmeta_load(&bc));

  sp_try(bc_run_begin(&bc, sp_str_lit("scan")));
  sp_log("{:<12} {.cyan}", sp_fmt_cstr("run_id:"), sp_fmt_uint(bc.run_id));

  bc.mtree.arena = sp_mem_arena_new_ex(mem, BC_ARENA_BLOCK_SIZE, SP_MEM_ARENA_MODE_DEFAULT, SP_MEM_ALIGNMENT);
  sp_str_ht_init(sp_mem_arena_as_allocator(bc.mtree.arena), bc.mtree.ht);
  sp_tm_timer_t mtree_timer = sp_tm_start_timer();
  sp_try(bc_mtree_load(&bc));
  bc.timings.mtree = sp_tm_read_timer(&mtree_timer);
  sp_log("{:<12} {.cyan} decoded, {.cyan} cached, {.cyan} entries",
    sp_fmt_cstr("mtree:"),
    sp_fmt_uint(bc.mtree.decoded),
    sp_fmt_uint(bc.mtree.cached),
    sp_fmt_uint(bc.mtree.entries));

  // Producer-side arena: the main thread bump-allocates every work item's
  // path into here. Workers borrow those slices for the duration of
  // processing; the arena outlives every worker.
  bc.work.arena = sp_mem_arena_new_ex(mem, BC_ARENA_BLOCK_SIZE, SP_MEM_ARENA_MODE_DEFAULT, SP_MEM_ALIGNMENT);
  bc_queue_init(mem, &bc.work.queue, BC_QUEUE_CAPACITY);
  bc_queue_init(mem, &bc.write,      BC_QUEUE_CAPACITY);

  sp_for(it, BC_NUM_WORKERS) {
    bc.workers[it].bc    = &bc;
    bc.workers[it].id    = it;
    bc.workers[it].arena = sp_mem_arena_new_ex(
      mem, BC_ARENA_BLOCK_SIZE, SP_MEM_ARENA_MODE_DEFAULT, SP_MEM_ALIGNMENT
    );
    sp_thread_init(&bc.workers[it].thread, bc_worker_fn, &bc.workers[it]);
  }

  bc.writer.bc = &bc;
  sp_try(bc_db_open_conn(bc.paths.cache, &bc.writer.sql));
  sp_thread_init(&bc.writer.thread, bc_writer_fn, &bc.writer);

  sp_tm_timer_t files_timer = sp_tm_start_timer(); {
    bc_enqueue_owned_files(&bc);
    bc_queue_close(&bc.work.queue);

    sp_for(it, BC_NUM_WORKERS) {
      sp_thread_join(&bc.workers[it].thread);
    }
    bc_queue_close(&bc.write);

    sp_thread_join(&bc.writer.thread);

    bc.timings.files = sp_tm_read_timer(&files_timer);
  }
  bc.timings.total = bc.timings.mtree + bc.timings.files;
  sp_try(bc_run_end(&bc, bc.timings.total));
  sp_try(bc.writer.err);

  u64 hits = 0, misses = 0, errors = 0;
  for (u32 i = 0; i < BC_NUM_WORKERS; i++) {
    hits   += bc.workers[i].hits;
    misses += bc.workers[i].misses;
    errors += bc.workers[i].errors;
  }

  sp_log("{:<12} {.cyan}", sp_fmt_cstr("packages:"), sp_fmt_uint(bc.num_packages));
  sp_log("{:<12} {.cyan}", sp_fmt_cstr("files:"),    sp_fmt_uint(bc.num_files));
  sp_log("{:<12} {.cyan}", sp_fmt_cstr("hits:"),     sp_fmt_uint(hits));
  sp_log("{:<12} {.cyan}", sp_fmt_cstr("misses:"),   sp_fmt_uint(misses));
  sp_log("{:<12} {.cyan}", sp_fmt_cstr("errors:"),   sp_fmt_uint(errors));
  sp_log("{:<12} {.cyan}", sp_fmt_cstr("writes:"),   sp_fmt_uint(bc.writer.writes));
  sp_log("{:<12} {.cyan .duration}", sp_fmt_cstr("t_mtree:"), sp_fmt_uint(bc.timings.mtree));
  sp_log("{:<12} {.cyan .duration}", sp_fmt_cstr("t_files:"), sp_fmt_uint(bc.timings.files));
  sp_log("{:<12} {.cyan .duration}", sp_fmt_cstr("t_total:"), sp_fmt_uint(bc.timings.total));

  sp_for(it, BC_NUM_WORKERS) {
    sp_mem_arena_destroy(bc.workers[it].arena);
  }
  sp_mem_arena_destroy(bc.work.arena);
  sp_mem_arena_destroy(bc.mtree.arena);
  alpm_release(bc.alpm);
  sqlite3_close(bc.writer.sql);
  sqlite3_close(bc.sql);
  return BC_OK;
}
