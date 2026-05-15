#include "mtree.h"
#include "sql.h"
#include "schema.h"

#include <alpm.h>
#include <alpm_list.h>

SP_PRIVATE sp_fs_kind_t bc_mtree_kind_from_archive(s32 ft) {
  if (ft == AE_IFREG) return SP_FS_KIND_FILE;
  if (ft == AE_IFDIR) return SP_FS_KIND_DIR;
  if (ft == AE_IFLNK) return SP_FS_KIND_SYMLINK;
  return SP_FS_KIND_NONE;
}

SP_PRIVATE bc_err_t bc_mtree_disk_mtime(bc_t* bc, sp_str_t local_dir, s64* out_mtime) {
  (void)bc;
  sp_sys_stat_t st = sp_zero;
  if (sp_sys_lstat_s(local_dir, &st) != 0) return BC_ERR;
  *out_mtime = st.mtime.tv_sec;
  return BC_OK;
}

SP_PRIVATE bc_err_t bc_mtree_load_entries(bc_t* bc, sp_str_t pkg) {
  sp_mem_t arena_mem = sp_mem_arena_as_allocator(bc->mtree.arena);

  sqlite3_stmt* stmt = SP_NULLPTR;
  bc_try(bc_sql_prepare(bc->sql, bc_db_select_mtree_entries, -1, &stmt));
  bc_sql_bind_str(stmt, 1, pkg);

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
  sqlite3_finalize(stmt);
  bc_try(bc_check_sql_e(bc->sql));

  return BC_OK;
}

SP_PRIVATE bc_err_t bc_mtree_decode(bc_t* bc, sp_str_t pkg, sp_str_t version, s64 mtree_mtime, sp_str_t mtree_path) {
  sp_mem_t arena_mem = sp_mem_arena_as_allocator(bc->mtree.arena);
  bc_err_t err = BC_OK;
  bool in_tx = false;

  sp_mem_arena_marker_t scratch = sp_mem_begin_scratch();
  c8* mtree_path_c = sp_str_to_cstr(sp_mem_arena_as_allocator(sp_mem_get_scratch_arena()), mtree_path);

  struct archive* a = archive_read_new();
  archive_read_support_filter_gzip(a);
  archive_read_support_format_mtree(a);
  struct {
    sqlite3_stmt* del;
    sqlite3_stmt* insert;
    sqlite3_stmt* upsert;
  } s = sp_zero;

  if (archive_read_open_filename(a, mtree_path_c, 8192) != ARCHIVE_OK) {
    sp_log_err("archive_read_open_filename {.red}: {}", sp_fmt_str(mtree_path), sp_fmt_cstr(archive_error_string(a)));
    err = BC_ERR;
    goto done;
  }

  bc_try_goto(bc_sql_prepare(bc->sql, bc_db_delete_mtree_entries, -1, &s.del), err, done);
  bc_try_goto(bc_sql_prepare(bc->sql, bc_db_insert_mtree_entry, -1, &s.insert), err, done);
  bc_try_goto(bc_sql_prepare(bc->sql, bc_db_upsert_mtree, -1, &s.upsert), err, done);

  bc_try_goto(bc_sql_exec(bc->sql, "BEGIN;"), err, done);
  in_tx = true;

  bc_sql_bind_str  (s.upsert, 1, pkg);
  bc_sql_bind_str  (s.upsert, 2, version);
  sqlite3_bind_int64(s.upsert, 3, mtree_mtime);
  bc_try_goto(bc_sql_step(bc->sql, s.upsert), err, done);

  bc_sql_bind_str(s.del, 1, pkg);
  bc_try_goto(bc_sql_step(bc->sql, s.del), err, done);

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

    sqlite3_reset(s.insert);
    bc_sql_bind_str  (s.insert, 1, pkg);
    bc_sql_bind_str  (s.insert, 2, e.path);
    sqlite3_bind_int  (s.insert, 3, e.kind);
    sqlite3_bind_int64(s.insert, 4, e.size);
    sqlite3_bind_int  (s.insert, 5, e.mode);
    sqlite3_bind_int  (s.insert, 6, e.uid);
    sqlite3_bind_int  (s.insert, 7, e.gid);
    sqlite3_bind_int64(s.insert, 8, e.mtime);
    if (e.have_hash) sqlite3_bind_blob(s.insert, 9, e.sha256, 32, SQLITE_STATIC);
    else             sqlite3_bind_null(s.insert, 9);
    if (!sp_str_empty(e.target)) bc_sql_bind_str(s.insert, 10, e.target);
    else                         sqlite3_bind_null(s.insert, 10);
    bc_try_goto(bc_sql_step(bc->sql, s.insert), err, done);
  }
  if (ar != ARCHIVE_EOF) {
    sp_log_err("mtree decode {.red}: {}", sp_fmt_str(mtree_path), sp_fmt_cstr(archive_error_string(a)));
    err = BC_ERR;
    goto done;
  }

  bc_try_goto(bc_sql_exec(bc->sql, "COMMIT;"), err, done);
  in_tx = false;

done:
  if (in_tx) bc_sql_exec(bc->sql, "ROLLBACK;");
  if (s.del) sqlite3_finalize(s.del);
  if (s.insert)   sqlite3_finalize(s.insert);
  if (s.upsert)   sqlite3_finalize(s.upsert);
  archive_read_free(a);
  sp_mem_end_scratch(scratch);
  return err;
}

bc_err_t bc_mtree_load(bc_t* bc) {
  sp_mem_t arena_mem = sp_mem_arena_as_allocator(bc->mtree.arena);

  sqlite3_stmt* sel = SP_NULLPTR;
  bc_err_t err = bc_sql_prepare(bc->sql, bc_db_select_mtree, -1, &sel);
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
    bc_sql_bind_str(sel, 1, pkg);
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
