#if !defined(BC_PACMAN_H)
#define BC_PACMAN_H

#include "bc.h"

bc_err_t bc_alpm_open(bc_t* bc);
void bc_enqueue_owned_files(bc_t* bc);
s32 bc_files_driver_fn(void* userdata);

#endif
