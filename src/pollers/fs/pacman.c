#include "pacman.h"
#include "queue.h"

#include <alpm.h>
#include <alpm_list.h>

bc_err_t bc_alpm_open(bc_t* bc) {
  sp_mem_arena_marker_t scratch = sp_mem_begin_scratch();
  sp_mem_t scratch_mem = sp_mem_arena_as_allocator(sp_mem_get_scratch_arena());
  c8* root = sp_str_to_cstr(scratch_mem, bc->paths.root);
  c8* db   = sp_str_to_cstr(scratch_mem, bc->paths.db);

  alpm_errno_t err = 0;
  bc->alpm = alpm_initialize(root, db, &err);
  sp_mem_end_scratch(scratch);
  if (err || !bc->alpm) {
    sp_log_err("alpm_initialize failed: {} ({})", sp_fmt_cstr(alpm_strerror(err)), sp_fmt_int(err));
    return BC_ERR;
  }
  return BC_OK;
}

void bc_enqueue_owned_files(bc_t* bc) {
  sp_mem_t arena_mem = sp_mem_arena_as_allocator(bc->work.arena);
  alpm_db_t* local = alpm_get_localdb(bc->alpm);
  alpm_list_t* cache = alpm_db_get_pkgcache(local);
  bc->num_packages = alpm_list_count(cache);

  bc_alpm_for(it, cache) {
    if (sp_atomic_s32_get(&bc->cancel)) return;
    alpm_pkg_t* pkg = it->data;
    alpm_filelist_t* files = alpm_pkg_get_files(pkg);
    if (!files) continue;
    for (u64 i = 0; i < files->count; i++) {
      const c8* name = files->files[i].name;
      if (!name) continue;

      sp_str_t name_view = sp_cstr_as_str(name);
      sp_str_t abs = sp_fs_join_path(arena_mem, bc->paths.root, name_view);
      // alpm directory entries end with '/'; sp_fs_join_path already strips
      // them, so abs is clean.
      if (sp_str_empty(abs)) continue;

      bc->num_files++;
      bc_queue_push(&bc->work.queue, abs);
    }
  }
}

s32 bc_files_driver_fn(void* userdata) {
  bc_t* bc = (bc_t*)userdata;
  bc_enqueue_owned_files(bc);
  bc_queue_close(&bc->work.queue);
  sp_for(it, BC_NUM_WORKERS) {
    sp_thread_join(&bc->workers[it].thread);
  }
  if (bc->prompt) sp_prompt_complete(bc->prompt);
  return 0;
}
