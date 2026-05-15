#include "walk.h"
#include "queue.h"

static const c8* bc_stray_ignore_prefixes [] = {
  "/dev",
  "/home",
  "/media",
  "/mnt",
  "/proc",
  "/root",
  "/run",
  "/sys",
  "/tmp",
  "/var/cache",
  "/var/lib/pacman",
};

SP_PRIVATE bool bc_path_is_ignored(sp_str_t path, sp_str_t cache_path) {
  sp_for(i, sp_carr_len(bc_stray_ignore_prefixes)) {
    sp_str_t pref = sp_cstr_as_str(bc_stray_ignore_prefixes[i]);
    if (sp_str_starts_with(path, pref)) {
      // Anchor at a path boundary so "/run" doesn't also ignore "/runtime".
      if (path.len == pref.len || path.data[pref.len] == '/') return true;
    }
  }
  if (cache_path.len && sp_str_equal(path, cache_path)) return true;
  return false;
}

SP_PRIVATE void bc_tui_send_stray_progress(sp_prompt_ctx_t* prompt, u64 seen, sp_str_t path) {
  if (!prompt) return;
  if (seen % 1024) return;
  sp_prompt_send_progress_u64(prompt, seen);
  sp_prompt_send_status_str(prompt, path);
}

void bc_walk_strays(bc_t* bc) {
  sp_mem_arena_t* arena = sp_mem_arena_new_ex(bc->mem, BC_ARENA_BLOCK_SIZE, SP_MEM_ARENA_MODE_DEFAULT, SP_MEM_ALIGNMENT);
  sp_mem_t mem = sp_mem_arena_as_allocator(arena);

  u64 seen = 0;
  sp_fs_for_recursive(mem, bc->paths.root, it) {
    if (sp_atomic_s32_get(&bc->cancel)) {
      break;
    }

    bc_tui_send_stray_progress(bc->prompt, ++seen, it.entry.path);

    if (!bc_path_is_ignored(it.entry.path, bc->paths.cache)) {
      bc->num_visited++;

      u64 idx;
      if (sp_str_ht_get_ex(bc->mtree.ht, it.entry.path, idx)) {
        continue;
      }

      bc_write_t out = sp_zero;
      out.kind = BC_WRITE_FINDING;
      out.finding.kind = BC_FINDING_STRAY;
      out.finding.path = sp_str_copy(mem, it.entry.path);
      out.finding.created_at = (s64)sp_tm_now_epoch().s;
      bc_queue_push(&bc->write, out);
      bc->num_strays++;
    }
  }

  sp_mem_arena_destroy(arena);
}

s32 bc_strays_driver_fn(void* userdata) {
  bc_t* bc = (bc_t*)userdata;
  bc_walk_strays(bc);
  if (bc->prompt) sp_prompt_complete(bc->prompt);
  return 0;
}
