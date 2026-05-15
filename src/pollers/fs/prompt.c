#include "prompt.h"
#include "queue.h"

static const u32 bc_scan_frames [] = {
  0x280B, 0x2819, 0x281A, 0x281E, 0x2816, 0x2826, 0x2834, 0x2832, 0x2833, 0x2813
};

SP_PRIVATE void bc_scan_on_event(sp_prompt_ctx_t* ctx, sp_prompt_event_t event) {
  bc_scan_widget_t* w = (bc_scan_widget_t*)ctx->user_data;
  switch (event.kind) {
    case SP_PROMPT_EVENT_INIT: {
      w->frame_index = 0;
      if (!w->driver_started) {
        w->driver_started = true;
        sp_thread_init(&w->driver, w->driver_fn, w->bc);
      }
      break;
    }
    case SP_PROMPT_EVENT_PROGRESS: {
      w->count = event.progress.data.u;
      break;
    }
    case SP_PROMPT_EVENT_STATUS: {
      w->status = event.status.value;
      break;
    }
    case SP_PROMPT_EVENT_CTRL_C:
    case SP_PROMPT_EVENT_ESCAPE: {
      sp_atomic_s32_set(&w->bc->cancel, 1);
      bc_queue_close(&w->bc->work.queue);
      sp_prompt_set_state(ctx, SP_PROMPT_STATE_CANCEL);
      break;
    }
    case SP_PROMPT_EVENT_ENTER:
    case SP_PROMPT_EVENT_NONE:
    case SP_PROMPT_EVENT_INPUT:
    case SP_PROMPT_EVENT_UP:
    case SP_PROMPT_EVENT_DOWN:
    case SP_PROMPT_EVENT_LEFT:
    case SP_PROMPT_EVENT_RIGHT:
    case SP_PROMPT_EVENT_TAB:
    case SP_PROMPT_EVENT_BACKSPACE:
    case SP_PROMPT_EVENT_ABORT: {
      break;
    }
  }
}

SP_PRIVATE void bc_scan_on_update(sp_prompt_ctx_t* ctx) {
  bc_scan_widget_t* w = (bc_scan_widget_t*)ctx->user_data;
  w->frame_index = (w->frame_index + 1) % sp_carr_len(bc_scan_frames);
}

SP_PRIVATE void bc_scan_render(sp_prompt_ctx_t* ctx) {
  bc_scan_widget_t* w = (bc_scan_widget_t*)ctx->user_data;
  sp_mem_arena_marker_t s = sp_mem_begin_scratch();

  switch (ctx->state) {
    case SP_PROMPT_STATE_SUBMIT: {
      sp_prompt_line(ctx, sp_fmt(s.mem, "Scanned: {}", sp_fmt_uint(w->count)).value);
      break;
    }
    case SP_PROMPT_STATE_CANCEL: {
      sp_prompt_line(ctx, sp_fmt(s.mem, "Cancelled after {}", sp_fmt_uint(w->count)).value);
      break;
    }
    default: {
      sp_str_t glyph = sp_prompt_repeat(ctx, bc_scan_frames[w->frame_index], 1);
      sp_prompt_line(ctx, sp_fmt(s.mem, "{}  {} {}",
        sp_fmt_str(glyph),
        sp_fmt_cstr(w->prompt),
        sp_fmt_uint(w->count)).value);
      if (!sp_str_empty(w->status)) {
        sp_prompt_line(ctx, sp_fmt(s.mem, "   {}", sp_fmt_str(w->status)).value);
      } else {
        sp_prompt_line(ctx, sp_str_lit(""));
      }
    }
  }

  sp_mem_end_scratch(s);
}

bc_scan_widget_t* bc_scan_widget_new(sp_prompt_ctx_t* ctx, bc_t* bc, const c8* prompt, s32 (*driver_fn)(void*)) {
  bc_scan_widget_t* w = sp_mem_arena_alloc_type(ctx->arena, bc_scan_widget_t);
  *w = (bc_scan_widget_t) {
    .bc         = bc,
    .prompt     = prompt,
    .status     = sp_str_lit(""),
    .driver_fn  = driver_fn,
  };
  return w;
}

sp_prompt_widget_t bc_scan_widget_as_prompt(bc_scan_widget_t* w) {
  return (sp_prompt_widget_t) {
    .user_data = w,
    .on_event  = bc_scan_on_event,
    .on_update = bc_scan_on_update,
    .render    = bc_scan_render,
    .fps       = 12,
  };
}
