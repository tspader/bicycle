#define SP_IMPLEMENTATION
#include "sp.h"

#include <alpm.h>
#include <alpm_list.h>
#include "sqlite3.h"

#include "sql/schema.h"
#include "sql/pragma.h"
#include "sql/stmt.h"

#define bc_alpm_for(it, list) for (alpm_list_t* it = list; it; it = alpm_list_next(it))

#define BC_NUM_WORKERS       8
#define BC_WORKER_BLOCK_SIZE (4u * 1024u * 1024u)
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
  c8  path [SP_PATH_MAX];
  u32 len;
} bc_work_t;

typedef enum {
  BC_WRITE_FILE_METADATA = 1,
} bc_write_kind_t;

typedef struct {
  bc_write_kind_t kind;
  bc_file_key_t   key;
  bc_file_meta_t  meta;
  sp_str_t        path;
} bc_write_t;

typedef struct {
  sp_mutex_t mu;
  sp_cv_t    not_empty;
  sp_cv_t    not_full;
  bool       closed;
  u32        capacity;
} bc_queue_hdr_t;

typedef struct {
  bc_queue_hdr_t hdr;
  sp_rb(bc_work_t) rb;
} bc_work_queue_t;

typedef struct {
  bc_queue_hdr_t hdr;
  sp_rb(bc_write_t) rb;
} bc_write_queue_t;

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

  struct {
    bc_fmeta_ht_t ht;
    sp_mutex_t mutex;
  } files;

  bc_work_queue_t   work;
  bc_write_queue_t  write;

  bc_worker_t       workers [BC_NUM_WORKERS];
  bc_writer_t       writer;
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

bc_err_t bc_db_open(bc_t* bc) {
  c8 buf [SP_PATH_MAX] = sp_zero;
  sp_cstr_copy_to_n(bc->paths.cache.data, bc->paths.cache.len, buf, SP_PATH_MAX);

  s32 rc = sqlite3_open(buf, &bc->sql);
  sp_try(bc_check_sql(bc->sql, rc));

  sp_try(bc_sql_exec(bc->sql, bc_db_pragmas));
  sp_try(bc_sql_exec(bc->sql, bc_db_schema));
  return BC_OK;
}

bc_err_t bc_alpm_open(bc_t* bc) {
  c8 root [SP_PATH_MAX] = sp_zero;
  c8 db [SP_PATH_MAX] = sp_zero;
  sp_cstr_copy_to_n(bc->paths.root.data, bc->paths.root.len, root, SP_PATH_MAX);
  sp_cstr_copy_to_n(bc->paths.db.data, bc->paths.db.len, db, SP_PATH_MAX);

  alpm_errno_t err = 0;
  bc->alpm = alpm_initialize(root, db, &err);
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
    sp_ht_insert(bc->files.ht, k, m);
    loaded++;
  }
  bc_err_t err = bc_check_sql(bc->sql, rc);
  sqlite3_finalize(stmt);
  sp_try(err);

  sp_log("{:<12} {.cyan}", sp_fmt_cstr("loaded:"), sp_fmt_uint(loaded));
  return BC_OK;
}

bc_file_meta_t* bc_fmeta_lookup(bc_t* bc, bc_file_key_t key) {
  sp_mutex_lock(&bc->files.mutex);
  bc_file_meta_t* v = sp_ht_getp(bc->files.ht, key);
  sp_mutex_unlock(&bc->files.mutex);
  return v;
}

//
// Queue helpers (mutex + cv around sp_ring_buffer)
//

void bc_work_queue_init(sp_mem_t mem, bc_work_queue_t* queue) {
  sp_mutex_init(&queue->hdr.mu, SP_MUTEX_PLAIN);
  sp_cv_init(&queue->hdr.not_empty);
  sp_cv_init(&queue->hdr.not_full);
  queue->hdr.closed   = false;
  queue->hdr.capacity = BC_QUEUE_CAPACITY;
  sp_rb_init_cap(mem, queue->rb, BC_QUEUE_CAPACITY);
}

void bc_write_queue_init(sp_mem_t mem, bc_write_queue_t* queue) {
  sp_mutex_init(&queue->hdr.mu, SP_MUTEX_PLAIN);
  sp_cv_init(&queue->hdr.not_empty);
  sp_cv_init(&queue->hdr.not_full);
  queue->hdr.closed   = false;
  queue->hdr.capacity = BC_QUEUE_CAPACITY;
  sp_rb_init_cap(mem, queue->rb, BC_QUEUE_CAPACITY);
}

void bc_work_queue_push(bc_work_queue_t* queue, const bc_work_t* item) {
  sp_mutex_lock(&queue->hdr.mu);
  while (sp_rb_size(queue->rb) >= queue->hdr.capacity) {
    sp_cv_wait(&queue->hdr.not_full, &queue->hdr.mu);
  }
  sp_rb_push(queue->rb, *item);
  sp_cv_notify_one(&queue->hdr.not_empty);
  sp_mutex_unlock(&queue->hdr.mu);
}

bool bc_work_queue_pop(bc_work_queue_t* queue, bc_work_t* out) {
  sp_mutex_lock(&queue->hdr.mu);
  while (sp_rb_empty(queue->rb) && !queue->hdr.closed) {
    sp_cv_wait(&queue->hdr.not_empty, &queue->hdr.mu);
  }
  if (sp_rb_empty(queue->rb)) {
    sp_mutex_unlock(&queue->hdr.mu);
    return false;
  }
  *out = *sp_rb_peek(queue->rb);
  sp_rb_pop(queue->rb);
  sp_cv_notify_one(&queue->hdr.not_full);
  sp_mutex_unlock(&queue->hdr.mu);
  return true;
}

void bc_work_queue_close(bc_work_queue_t* queue) {
  sp_mutex_lock(&queue->hdr.mu);
  queue->hdr.closed = true;
  sp_cv_notify_all(&queue->hdr.not_empty);
  sp_mutex_unlock(&queue->hdr.mu);
}

void bc_write_queue_push(bc_write_queue_t* queue, const bc_write_t* item) {
  sp_mutex_lock(&queue->hdr.mu);
  while (sp_rb_size(queue->rb) >= queue->hdr.capacity) {
    sp_cv_wait(&queue->hdr.not_full, &queue->hdr.mu);
  }
  sp_rb_push(queue->rb, *item);
  sp_cv_notify_one(&queue->hdr.not_empty);
  sp_mutex_unlock(&queue->hdr.mu);
}

bool bc_write_queue_pop(bc_write_queue_t* queue, bc_write_t* out) {
  sp_mutex_lock(&queue->hdr.mu);
  while (sp_rb_empty(queue->rb) && !queue->hdr.closed) {
    sp_cv_wait(&queue->hdr.not_empty, &queue->hdr.mu);
  }
  if (sp_rb_empty(queue->rb)) {
    sp_mutex_unlock(&queue->hdr.mu);
    return false;
  }
  *out = *sp_rb_peek(queue->rb);
  sp_rb_pop(queue->rb);
  sp_cv_notify_one(&queue->hdr.not_full);
  sp_mutex_unlock(&queue->hdr.mu);
  return true;
}

void bc_write_queue_close(bc_write_queue_t* queue) {
  sp_mutex_lock(&queue->hdr.mu);
  queue->hdr.closed = true;
  sp_cv_notify_all(&queue->hdr.not_empty);
  sp_mutex_unlock(&queue->hdr.mu);
}

//
// Worker thread: pop path, lstat, compare against cache, emit metadata write on miss
//

s32 bc_worker_fn(void* userdata) {
  bc_worker_t* w = (bc_worker_t*)userdata;
  bc_t* bc = w->bc;
  sp_mem_t arena_mem = sp_mem_arena_as_allocator(w->arena);

  bc_work_t item;
  while (bc_work_queue_pop(&bc->work, &item)) {
    sp_str_t path_view = (sp_str_t){ .data = item.path, .len = item.len };

    sp_sys_stat_t st = sp_zero;
    if (sp_sys_lstat_s(path_view, &st) != 0) {
      w->errors++;
      continue;
    }

    if (st.kind != SP_FS_KIND_FILE) {
      // Only regular files participate in the file_metadata cache for now;
      // directories and symlinks are handled later via mtree comparison.
      continue;
    }

    bc_file_key_t key = { .dev = st.device, .ino = st.id };
    bc_file_meta_t* hit = bc_fmeta_lookup(bc, key);
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
    out.kind            = BC_WRITE_FILE_METADATA;
    out.key             = key;
    out.meta.mtime_sec  = st.mtime.tv_sec;
    out.meta.mtime_nsec = st.mtime.tv_nsec;
    out.meta.ctime_sec  = st.btime.tv_sec;
    out.meta.ctime_nsec = st.btime.tv_nsec;
    out.meta.size       = st.size;
    // sha256 left as zero placeholder; hashing happens in a later step.
    out.path = sp_str_copy(arena_mem, path_view);

    bc_write_queue_push(&bc->write, &out);
  }
  return BC_OK;
}

//
// Writer thread: batch upserts into file_metadata
//

#define bc_writer_try(expr) \
  do { \
    w->err = (expr);  \
    if (w->err) return w->err; \
  } while (0)

s32 bc_writer_fn(void* userdata) {
  bc_writer_t* w = (bc_writer_t*)userdata;
  bc_t* bc = w->bc;

  sqlite3_stmt* upsert = SP_NULLPTR;
  bc_writer_try(bc_check_sql(bc->sql, sqlite3_prepare_v2(bc->sql, bc_db_upsert_file_metadata, -1, &upsert, SP_NULLPTR)));

  u8 zero_hash [32] = sp_zero;
  bool in_tx = false;
  u32 in_batch = 0;

  bc_write_t item;
  while (bc_write_queue_pop(&bc->write, &item)) {
    if (!in_tx) {
      w->err = bc_sql_exec(bc->sql, "BEGIN;");
      if (w->err) break;
      in_tx = true;
      in_batch = 0;
    }

    sqlite3_reset(upsert);
    sqlite3_bind_int64(upsert,  1, (s64)item.key.dev);
    sqlite3_bind_int64(upsert,  2, (s64)item.key.ino);
    sqlite3_bind_int64(upsert,  3, item.meta.mtime_sec);
    sqlite3_bind_int64(upsert,  4, item.meta.mtime_nsec);
    sqlite3_bind_int64(upsert,  5, item.meta.ctime_sec);
    sqlite3_bind_int64(upsert,  6, item.meta.ctime_nsec);
    sqlite3_bind_int64(upsert,  7, item.meta.size);
    sqlite3_bind_blob (upsert,  8, zero_hash, 32, SQLITE_STATIC);
    sqlite3_bind_text (upsert,  9, item.path.data, (s32)item.path.len, SQLITE_STATIC);
    sqlite3_bind_int64(upsert, 10, (s64)bc->run_id);

    bc_writer_try(bc_check_sql(bc->sql, sqlite3_step(upsert)));
    w->writes++;
    in_batch++;

    if (in_batch >= BC_WRITE_BATCH) {
      bc_writer_try(bc_sql_exec(bc->sql, "COMMIT;"));
      in_tx = false;
    }
  }

  if (!w->err && in_tx) w->err = bc_sql_exec(bc->sql, "COMMIT;");
  else if (w->err && in_tx) bc_sql_exec(bc->sql, "ROLLBACK;");

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
// Producer: walk every libalpm-owned file, enqueue into the work queue
//

void bc_enqueue_owned_files(bc_t* bc) {
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

      bc_work_t item = sp_zero;
      u32 root_len = bc->paths.root.len;
      u32 name_len = (u32)sp_cstr_len(name);

      // Compose absolute path: root + name. alpm gives names relative to root,
      // without a leading slash. Strip a duplicate slash if root ends with one.
      u32 ri = root_len;
      while (ri > 0 && bc->paths.root.data[ri - 1] == '/') ri--;
      if (ri > SP_PATH_MAX) ri = SP_PATH_MAX;
      sp_mem_copy(item.path, bc->paths.root.data, ri);
      u32 cursor = ri;
      if (cursor < SP_PATH_MAX) item.path[cursor++] = '/';
      u32 to_copy = name_len;
      if (cursor + to_copy > SP_PATH_MAX) to_copy = SP_PATH_MAX - cursor;
      sp_mem_copy(item.path + cursor, name, to_copy);
      cursor += to_copy;
      item.len = cursor;

      // alpm directory entries end with '/'. Drop the trailing slash;
      // lstat() doesn't want it, and our cache only tracks regular files
      // anyway (worker filters by st.kind).
      while (item.len > 0 && item.path[item.len - 1] == '/') item.len--;
      if (item.len == 0) continue;

      bc->num_files++;
      bc_work_queue_push(&bc->work, &item);
    }
  }
}

s32 main(s32 num_args, const c8** args) {
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

  // In-memory file metadata cache, loaded from SQLite once. Immutable for the run.
  sp_mutex_init(&bc.files.mutex, SP_MUTEX_PLAIN);
  sp_ht_init(mem, bc.files.ht);
  sp_try(bc_fmeta_load(&bc));

  sp_try(bc_run_begin(&bc, sp_str_lit("scan")));
  sp_log("{:<12} {.cyan}", sp_fmt_cstr("run_id:"), sp_fmt_uint(bc.run_id));

  bc_work_queue_init(mem, &bc.work);
  bc_write_queue_init(mem, &bc.write);

  // Spawn workers. Each owns an arena it uses to permanently retain path
  // strings referenced by the writes it produces; arenas outlive the writer.
  sp_for(it, BC_NUM_WORKERS) {
    bc.workers[it].bc    = &bc;
    bc.workers[it].id    = it;
    bc.workers[it].arena = sp_mem_arena_new_ex(
      mem, BC_WORKER_BLOCK_SIZE, SP_MEM_ARENA_MODE_DEFAULT, SP_MEM_ALIGNMENT
    );
    sp_thread_init(&bc.workers[it].thread, bc_worker_fn, &bc.workers[it]);
  }

  bc.writer.bc = &bc;
  sp_thread_init(&bc.writer.thread, bc_writer_fn, &bc.writer);

  u64 elapsed_ns = 0;
  sp_tm_timer_t timer = sp_tm_start_timer(); {
    bc_enqueue_owned_files(&bc);
    bc_work_queue_close(&bc.work);

    sp_for(it, BC_NUM_WORKERS) {
      sp_thread_join(&bc.workers[it].thread);
    }
    bc_write_queue_close(&bc.write);

    sp_thread_join(&bc.writer.thread);

    elapsed_ns = sp_tm_read_timer(&timer);
  }
  sp_try(bc_run_end(&bc, elapsed_ns));
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
  sp_log("{:<12} {.cyan} ns", sp_fmt_cstr("elapsed:"),  sp_fmt_uint(elapsed_ns));

  sp_for(it, BC_NUM_WORKERS) {
    sp_mem_arena_destroy(bc.workers[it].arena);
  }

  alpm_release(bc.alpm);
  sqlite3_close(bc.sql);
  return BC_OK;
}
