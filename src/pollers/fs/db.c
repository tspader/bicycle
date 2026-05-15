#include "db.h"
#include "sql.h"
#include "schema.h"
#include "queue.h"

bc_err_t bc_db_open_conn(sp_str_t path, sqlite3** out) {
  sp_mem_arena_marker_t scratch = sp_mem_begin_scratch();
  c8* cpath = sp_str_to_cstr(sp_mem_arena_as_allocator(sp_mem_get_scratch_arena()), path);
  s32 rc = sqlite3_open(cpath, out);
  sp_mem_end_scratch(scratch);
  bc_try(bc_check_sql(*out, rc));
  bc_try(bc_sql_exec(*out, bc_db_pragmas));
  return BC_OK;
}

bc_err_t bc_db_open(bc_t* bc) {
  bc_try(bc_db_open_conn(bc->paths.cache, &bc->sql));
  bc_try(bc_sql_exec(bc->sql, bc_db_schema));
  return BC_OK;
}

bc_err_t bc_fmeta_load(bc_t* bc) {
  sqlite3_stmt* stmt = SP_NULLPTR;
  bc_try(bc_sql_prepare(bc->sql, bc_db_select_file_metadata, -1, &stmt));

  s32 rc = 0;
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
  }
  sqlite3_finalize(stmt);
  bc_try(bc_check_sql_e(bc->sql));

  return BC_OK;
}

bc_err_t bc_run_begin(bc_t* bc, sp_str_t action) {
  sqlite3_stmt* s = SP_NULLPTR;
  bc_try(bc_sql_prepare(bc->sql, bc_db_insert_meta_run, -1, &s));

  sp_tm_epoch_t now = sp_tm_now_epoch();
  bc_sql_bind_u64(s, 1, now.s);
  bc_sql_bind_str(s, 2, action);
  sqlite3_bind_null(s, 3);
  sqlite3_step(s);
  sqlite3_finalize(s);
  bc_try(bc_check_sql_e(bc->sql));

  bc->run_id = (u64)sqlite3_last_insert_rowid(bc->sql);
  return BC_OK;
}

bc_err_t bc_run_end(bc_t* bc, u64 elapsed_ns) {
  sqlite3_stmt* s = SP_NULLPTR;
  bc_try(bc_sql_prepare(bc->sql, bc_db_update_meta_run_elapsed, -1, &s));

  sqlite3_bind_double(s, 1, (f64)elapsed_ns);
  bc_sql_bind_u64(s, 2, bc->run_id);
  sqlite3_step(s);
  sqlite3_finalize(s);
  bc_try(bc_check_sql_e(bc->sql));

  return BC_OK;
}

#define bc_writer_try(expr) bc_try_goto((expr), w->err, done)

s32 bc_writer_fn(void* userdata) {
  bc_writer_t* w = (bc_writer_t*)userdata;
  bc_t* bc = w->bc;

  struct {
    sqlite3_stmt* file;
    sqlite3_stmt* finding;
  } s = sp_zero;
  u32 in_batch = 0;

  bc_writer_try(bc_sql_prepare(w->sql, bc_db_upsert_file_metadata, -1, &s.file));
  bc_writer_try(bc_sql_prepare(w->sql, bc_db_insert_finding, -1, &s.finding));
  bc_writer_try(bc_sql_exec(w->sql, "BEGIN;"));

  bc_write_t item;
  while (bc_queue_pop(&w->bc->write, &item)) {
    switch (item.kind) {
      case BC_WRITE_FILE: {
        sqlite3_reset(s.file);
        bc_sql_bind_u64(s.file, 1, item.file.key.dev);
        bc_sql_bind_u64(s.file, 2, item.file.key.ino);
        sqlite3_bind_int64(s.file, 3, item.file.meta.mtime_sec);
        sqlite3_bind_int64(s.file, 4, item.file.meta.mtime_nsec);
        sqlite3_bind_int64(s.file, 5, item.file.meta.ctime_sec);
        sqlite3_bind_int64(s.file, 6, item.file.meta.ctime_nsec);
        sqlite3_bind_int64(s.file, 7, item.file.meta.size);
        sqlite3_bind_blob(s.file, 8, item.file.meta.sha256, 32, SQLITE_STATIC);
        bc_sql_bind_str(s.file, 9, item.file.path);
        bc_sql_bind_u64(s.file, 10, bc->run_id);
        bc_writer_try(bc_sql_step(w->sql, s.file));
        break;
      }
      case BC_WRITE_FINDING: {
        sqlite3_reset(s.finding);
        bc_sql_bind_u64(s.finding, 1, bc->run_id);
        sqlite3_bind_int(s.finding, 2, item.finding.kind);
        bc_sql_bind_str(s.finding, 3, bc_finding_detail_label(item.finding.detail));
        bc_sql_bind_str(s.finding, 4, item.finding.path);
        if (!sp_str_empty(item.finding.pkg)) {
          bc_sql_bind_str(s.finding, 5, item.finding.pkg);
        } else {
          sqlite3_bind_null(s.finding, 5);
        }
        sqlite3_bind_int64(s.finding, 6, item.finding.created_at);
        bc_writer_try(bc_sql_step(w->sql, s.finding));
        break;
      }
    }

    w->writes++;
    in_batch++;
    if (in_batch >= BC_WRITE_BATCH) {
      bc_writer_try(bc_sql_exec(w->sql, "COMMIT;"));
      bc_writer_try(bc_sql_exec(w->sql, "BEGIN;"));
      in_batch = 0;
    }
  }

  {
    sqlite3_stmt* prune = SP_NULLPTR;
    bc_writer_try(bc_sql_prepare(w->sql, bc_db_prune_file_metadata, -1, &prune));
    bc_sql_bind_u64(prune, 1, bc->run_id);
    s32 prc = bc_sql_step(w->sql, prune);
    sqlite3_finalize(prune);
    bc_writer_try(prc);
  }

  bc_writer_try(bc_sql_exec(w->sql, "COMMIT;"));

done:
  sqlite3_finalize(s.file);
  sqlite3_finalize(s.finding);

  if (w->err) {
    bc_sql_exec(w->sql, "ROLLBACK;");
    // Unblock anyone waiting to push work to the queue
    bc_queue_close(&w->bc->write);
  }

  return w->err;
}

sp_str_t bc_finding_kind_label(bc_finding_kind_t k) {
  switch (k) {
    case BC_FINDING_MODIFIED_META:    return sp_str_lit("modified-meta");
    case BC_FINDING_MODIFIED_CONTENT: return sp_str_lit("modified-content");
    case BC_FINDING_MISSING:          return sp_str_lit("missing");
    case BC_FINDING_UNTRACKED:        return sp_str_lit("untracked");
    case BC_FINDING_STRAY:            return sp_str_lit("stray");
  }
  return sp_str_lit("?");
}

sp_str_t bc_finding_detail_label(bc_finding_detail_t d) {
  switch (d) {
    case BC_FINDING_DETAIL_NONE:   return sp_str_lit("none");
    case BC_FINDING_DETAIL_KIND:   return sp_str_lit("kind");
    case BC_FINDING_DETAIL_MODE:   return sp_str_lit("mode");
    case BC_FINDING_DETAIL_UID:    return sp_str_lit("uid");
    case BC_FINDING_DETAIL_GID:    return sp_str_lit("gid");
    case BC_FINDING_DETAIL_SIZE:   return sp_str_lit("size");
    case BC_FINDING_DETAIL_TARGET: return sp_str_lit("target");
  }
  return sp_str_lit("?");
}

void bc_print_findings_for_run(bc_t* bc) {
  sqlite3_stmt* stmt = SP_NULLPTR;
  if (bc_sql_prepare(bc->sql, bc_db_select_findings_for_run, -1, &stmt)) return;
  bc_sql_bind_u64(stmt, 1, bc->run_id);

  s32 rc;
  while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
    bc_finding_kind_t kind = (bc_finding_kind_t)sqlite3_column_int(stmt, 0);
    sp_str_t detail = {
      .data = (const c8*)sqlite3_column_text (stmt, 1),
      .len  = (u32)      sqlite3_column_bytes(stmt, 1),
    };
    sp_str_t path = {
      .data = (const c8*)sqlite3_column_text(stmt, 2),
      .len  = (u32)sqlite3_column_bytes(stmt, 2),
    };
    sp_str_t pkg = sp_zero;
    if (sqlite3_column_type(stmt, 3) != SQLITE_NULL) {
      pkg.data = (const c8*)sqlite3_column_text (stmt, 3);
      pkg.len  = (u32)      sqlite3_column_bytes(stmt, 3);
    }

    sp_log("{.yellow} {} {} {.cyan}",
      sp_fmt_str(bc_finding_kind_label(kind)),
      sp_fmt_str(detail),
      sp_fmt_str(path),
      sp_fmt_str(pkg.len ? pkg : sp_str_lit("-")));
  }
  sqlite3_finalize(stmt);
}
