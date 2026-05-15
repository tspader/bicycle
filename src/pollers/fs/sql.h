#if !defined(BC_SQL_H)
#define BC_SQL_H

#include "bc.h"

bc_err_t bc_check_sql(sqlite3* sql, s32 rc);
bc_err_t bc_check_sql_e(sqlite3* sql);
bc_err_t bc_sql_exec(sqlite3* sql, const c8* statement);
bc_err_t bc_sql_prepare(sqlite3* sql, const c8* source, s32 len, sqlite3_stmt** s);
bc_err_t bc_sql_step(sqlite3* sql, sqlite3_stmt* s);
void bc_sql_bind_u64(sqlite3_stmt* s, s32 slot, u64 value);
void bc_sql_bind_str(sqlite3_stmt* s, s32 slot, sp_str_t str);

#endif
