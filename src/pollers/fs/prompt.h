#if !defined(BC_PROMPT_H)
#define BC_PROMPT_H

#include "bc.h"

typedef struct {
  bc_t*           bc;
  const c8*       prompt;
  u32             frame_index;
  u64             count;
  sp_str_t        status;
  s32             (*driver_fn)(void*);
  sp_thread_t     driver;
  bool            driver_started;
} bc_scan_widget_t;

bc_scan_widget_t* bc_scan_widget_new(sp_prompt_ctx_t* ctx, bc_t* bc, const c8* prompt, s32 (*driver_fn)(void*));
sp_prompt_widget_t bc_scan_widget_as_prompt(bc_scan_widget_t* w);

#endif
