#if !defined(BC_EMIT_H)
#define BC_EMIT_H

#include "bc.h"

void bc_emit_open(bc_t* bc);
void bc_emit_finding(bc_t* bc, const bc_write_finding_t* f);
void bc_emit_progress(bc_t* bc, u64 done);

#endif
