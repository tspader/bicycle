#if !defined(BC_WALK_H)
#define BC_WALK_H

#include "bc.h"

bc_err_t bc_ignores_load(bc_t* bc);
bc_err_t bc_claims_load(bc_t* bc);
void bc_walk_strays(bc_t* bc);
s32 bc_strays_driver_fn(void* userdata);

#endif
