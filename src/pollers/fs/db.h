#if !defined(BC_DB_H)
#define BC_DB_H

#include "bc.h"

bc_err_t bc_db_open_conn(sp_str_t path, sqlite3** out);
bc_err_t bc_db_open(bc_t* bc);
bc_err_t bc_fmeta_load(bc_t* bc);

bc_err_t bc_run_begin(bc_t* bc, sp_str_t action);
bc_err_t bc_run_end(bc_t* bc, u64 elapsed_ns);

s32 bc_writer_fn(void* userdata);

sp_str_t bc_finding_kind_label(bc_finding_kind_t k);
sp_str_t bc_finding_detail_label(bc_finding_detail_t d);
void bc_print_findings_for_run(bc_t* bc);

#endif
