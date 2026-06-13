#include "walk.h"
#include "bc.h"
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

SP_PRIVATE bool bc_prefix_match(sp_str_t path, sp_str_t pref) {
  if (sp_str_empty(pref)) return false;
  if (!sp_str_starts_with(path, pref)) return false;
  // Anchor at a path boundary so "/run" doesn't also ignore "/runtime".
  return path.len == pref.len || path.data[pref.len] == '/';
}

SP_PRIVATE sp_da(sp_str_t) bc_env_file_lines(bc_t* bc, sp_str_t path) {
  sp_str_t content = sp_zero;
  if (sp_io_read_file(bc->mem, path, &content)) {
    sp_log_err("failed to read {.red}", sp_fmt_str(path));
    return SP_NULLPTR;
  }
  return sp_str_split_c8(bc->mem, content, '\n');
}

SP_PRIVATE sp_str_t bc_env_line_value(sp_str_t line) {
  return sp_str_strip_right(sp_str_trim(sp_str_sub(line, 2, line.len - 2)), sp_str_lit("/"));
}

bc_err_t bc_ignores_load(bc_t* bc) {
  sp_da_init(bc->mem, bc->ignores.prunes);

  sp_str_t path = sp_os_env_get(sp_str_lit("BICYCLE_IGNORES"));
  if (sp_str_empty(path)) {
    sp_carr_for(bc_stray_ignore_prefixes, it) {
      sp_da_push(bc->ignores.prunes, sp_cstr_as_str(bc_stray_ignore_prefixes[it]));
    }
    return BC_OK;
  }

  sp_da(sp_str_t) lines = bc_env_file_lines(bc, path);
  if (!lines) return BC_ERR;
  sp_da_for(lines, it) {
    sp_str_t line = sp_str_trim(lines[it]);
    if (line.len < 3) continue;
    if (sp_str_starts_with(line, sp_str_lit("P "))) {
      sp_da_push(bc->ignores.prunes, bc_env_line_value(line));
    }
  }
  return BC_OK;
}

bc_err_t bc_claims_load(bc_t* bc) {
  sp_str_ht_init(bc->mem, bc->claims.exact);
  sp_da_init(bc->mem, bc->claims.prefixes);

  sp_str_t path = sp_os_env_get(sp_str_lit("BICYCLE_CLAIMS"));
  if (sp_str_empty(path)) return BC_OK;

  sp_da(sp_str_t) lines = bc_env_file_lines(bc, path);
  if (!lines) return BC_ERR;
  sp_da_for(lines, it) {
    sp_str_t line = sp_str_trim(lines[it]);
    if (line.len < 3) continue;
    if (sp_str_starts_with(line, sp_str_lit("P "))) {
      sp_da_push(bc->claims.prefixes, bc_env_line_value(line));
    }
    else if (sp_str_starts_with(line, sp_str_lit("E "))) {
      sp_str_ht_insert(bc->claims.exact, bc_env_line_value(line), true);
    }
  }
  return BC_OK;
}

SP_PRIVATE bool bc_path_is_pruned(bc_t* bc, sp_str_t path) {
  sp_da_for(bc->ignores.prunes, it) {
    if (bc_prefix_match(path, bc->ignores.prunes[it])) return true;
  }
  sp_da_for(bc->claims.prefixes, it) {
    if (bc_prefix_match(path, bc->claims.prefixes[it])) return true;
  }
  return false;
}

SP_PRIVATE void bc_walk_prune(sp_fs_it_t* it) {
  if (it->entry.kind != SP_FS_KIND_DIR) return;
  if (sp_da_empty(it->stack)) return;
  sp_fs_it_frame_t* top = sp_da_back(it->stack);
  if (!sp_str_equal(top->path, it->entry.path)) return;
  sp_sys_fs_it_close(&top->sys);
  sp_da_pop(it->stack);
}

SP_PRIVATE void bc_tui_send_stray_progress(sp_prompt_ctx_t* prompt, u64 seen, sp_str_t path) {
  if (!prompt) return;
  if (seen % 1024) return;
  sp_prompt_send_progress_u64(prompt, seen);
  sp_prompt_send_status_str(prompt, path);
}

SP_PRIVATE void bc_ndjson_send_stray_progress(bc_t* bc, u64 seen) {
  if (!bc->ndjson) return;
  if (seen & 2047) return;
  bc_write_t out = sp_zero;
  out.kind = BC_WRITE_PROGRESS;
  out.progress.done = (u64)sp_atomic_s32_get(&bc->files_scanned) + seen;
  bc_queue_push(&bc->write, out);
}

SP_PRIVATE void bc_stray_stat(sp_str_t path, bc_write_finding_t* f) {
  c8 buf [SP_PATH_MAX];
  if (path.len >= SP_PATH_MAX) return;
  sp_cstr_copy_to_n(path.data, path.len, buf, SP_PATH_MAX);
  struct stat st;
  if (lstat(buf, &st) != 0) return;
  f->stat.valid = true;
  f->stat.size = (s64)st.st_size;
  f->stat.uid = (s64)st.st_uid;
  f->stat.gid = (s64)st.st_gid;
}

void bc_walk_strays(bc_t* bc) {
  sp_mem_arena_marker_t s = sp_mem_begin_scratch();

  u64 seen = 0;
  sp_fs_for_recursive(s.mem, bc->paths.root, it) {
    if (sp_atomic_s32_get(&bc->cancel)) {
      break;
    }

    seen++;
    bc_tui_send_stray_progress(bc->prompt, seen, it.entry.path);
    bc_ndjson_send_stray_progress(bc, seen);

    if (bc_path_is_pruned(bc, it.entry.path)) {
      bc_walk_prune(&it);
      continue;
    }
    if (!sp_str_empty(bc->paths.cache) && sp_str_starts_with(it.entry.path, bc->paths.cache)) {
      continue;
    }

    bc->num_visited++;

    u64 idx;
    if (sp_str_ht_get_ex(bc->mtree.ht, it.entry.path, idx)) {
      continue;
    }
    if (sp_str_ht_get_ex(bc->claims.exact, it.entry.path, idx)) {
      continue;
    }

    bc_write_t out = sp_zero;
    out.kind = BC_WRITE_FINDING;
    out.finding.kind = BC_FINDING_STRAY;
    out.finding.detail = BC_FINDING_DETAIL_NONE;
    out.finding.path = sp_str_copy(bc->mem, it.entry.path);
    bc_stray_stat(it.entry.path, &out.finding);
    bc_queue_push(&bc->write, out);
    bc->num_strays++;
  }

  sp_mem_end_scratch(s);
}

s32 bc_strays_driver_fn(void* userdata) {
  bc_t* bc = (bc_t*)userdata;
  bc_walk_strays(bc);
  if (bc->prompt) sp_prompt_complete(bc->prompt);
  return 0;
}
