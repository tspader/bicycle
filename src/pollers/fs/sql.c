#include "sql.h"

bc_err_t bc_check_sql(sqlite3* sql, s32 rc) {
  if (rc != SQLITE_OK && rc != SQLITE_DONE && rc != SQLITE_ROW) {
    sp_log_err("sqlite error: {.red} (code {})", sp_fmt_cstr(sqlite3_errmsg(sql)), sp_fmt_int(rc));
    return BC_ERR;
  }
  return BC_OK;
}

bc_err_t bc_check_sql_e(sqlite3* sql) {
  s32 rc = sqlite3_errcode(sql);
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

bc_err_t bc_sql_prepare(sqlite3* sql, const c8* source, s32 len, sqlite3_stmt** s) {
  s32 rc = sqlite3_prepare_v2(sql, source, -1, s, SP_NULLPTR);
  return bc_check_sql(sql, rc);
}

bc_err_t bc_sql_step(sqlite3* sql, sqlite3_stmt* s) {
  s32 rc = sqlite3_step(s);
  return bc_check_sql(sql, rc);
}

void bc_sql_bind_u64(sqlite3_stmt* s, s32 slot, u64 value) {
  sqlite3_bind_int64(s, slot, (s64)value);
}

void bc_sql_bind_str(sqlite3_stmt* s, s32 slot, sp_str_t str) {
  sqlite3_bind_text(s, slot, str.data, str.len, SQLITE_STATIC);
}
