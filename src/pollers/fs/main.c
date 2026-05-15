#define SP_IMPLEMENTATION
#include "bc.h"

#include "pacman.h"
#include "db.h"

#include <alpm.h>
#include "mtree.h"
#include "prompt.h"
#include "queue.h"
#include "walk.h"
#include "worker.h"

s32 main(s32 num_args, const c8** args) {
  (void)num_args; (void)args;
  sp_mem_t mem = sp_mem_os_new();

  bc_t bc = sp_zero;
  bc.mem = mem;
  bc.paths.root = sp_str_lit("/");
  bc.paths.db = sp_str_lit("/var/lib/pacman");
  bc.paths.cache = sp_os_env_get(sp_str_lit("BC_DB"));
  if (sp_str_empty(bc.paths.cache)) {
    sp_str_t cache_dir = sp_fs_join_path(mem, sp_fs_get_cwd(mem), sp_str_lit(".cache"));
    sp_fs_create_dir(cache_dir);
    bc.paths.cache = sp_fs_join_path(mem, cache_dir, sp_str_lit("bicycle.db"));
  }

  bc_try(bc_db_open(&bc));
  bc_try(bc_alpm_open(&bc));

  sp_ht_init(mem, bc.files);
  bc_try(bc_fmeta_load(&bc));

  bc_try(bc_run_begin(&bc, sp_str_lit("scan")));
  sp_log("{:<12} {.cyan}", sp_fmt_cstr("run_id:"), sp_fmt_uint(bc.run_id));

  bc.mtree.arena = sp_mem_arena_new_ex(mem, BC_ARENA_BLOCK_SIZE, SP_MEM_ARENA_MODE_DEFAULT, SP_MEM_ALIGNMENT);
  sp_str_ht_init(sp_mem_arena_as_allocator(bc.mtree.arena), bc.mtree.ht);
  sp_tm_timer_t mtree_timer = sp_tm_start_timer();
  bc_try(bc_mtree_load(&bc));
  bc.timings.mtree = sp_tm_read_timer(&mtree_timer);
  sp_log("{:<12} {.cyan} decoded, {.cyan} cached, {.cyan} entries",
    sp_fmt_cstr("mtree:"),
    sp_fmt_uint(bc.mtree.decoded),
    sp_fmt_uint(bc.mtree.cached),
    sp_fmt_uint(bc.mtree.entries));

  // Producer-side arena: the main thread bump-allocates every work item's
  // path into here. Workers borrow those slices for the duration of
  // processing; the arena outlives every worker.
  bc.work.arena = sp_mem_arena_new_ex(mem, BC_ARENA_BLOCK_SIZE, SP_MEM_ARENA_MODE_DEFAULT, SP_MEM_ALIGNMENT);
  bc_queue_init(mem, &bc.work.queue, BC_QUEUE_CAPACITY);
  bc_queue_init(mem, &bc.write,      BC_QUEUE_CAPACITY);

  sp_for(it, BC_NUM_WORKERS) {
    bc.workers[it].bc    = &bc;
    bc.workers[it].id    = it;
    bc.workers[it].arena = sp_mem_arena_new_ex(
      mem, BC_ARENA_BLOCK_SIZE, SP_MEM_ARENA_MODE_DEFAULT, SP_MEM_ALIGNMENT
    );
    bc.workers[it].md_ctx   = EVP_MD_CTX_new();
    bc.workers[it].hash_buf = sp_mem_allocator_alloc(mem, BC_HASH_BUF_SIZE);
    sp_thread_init(&bc.workers[it].thread, bc_worker_fn, &bc.workers[it]);
  }

  bc.writer.bc = &bc;
  bc_try(bc_db_open_conn(bc.paths.cache, &bc.writer.sql));
  sp_thread_init(&bc.writer.thread, bc_writer_fn, &bc.writer);

  if (!sp_os_is_tty(sp_sys_stdin)) {
    bc_files_driver_fn(&bc);
    bc_walk_strays(&bc);
    goto done;
  }

  bc.prompt = sp_prompt_begin(mem);
  sp_assert(bc.prompt);

  struct {
    sp_tm_timer_t alpm;
    sp_tm_timer_t strays;
  } timers = sp_zero;

  timers.alpm = sp_tm_start_timer(); {
    bc_scan_widget_t* w = bc_scan_widget_new(bc.prompt, &bc, "Scanning files owned by Pacman", bc_files_driver_fn);
    sp_prompt_run(bc.prompt, bc_scan_widget_as_prompt(w));

    if (w->driver_started) sp_thread_join(&w->driver);
    bc.timings.alpm = sp_tm_read_timer(&timers.alpm);
  }
  if (sp_atomic_s32_get(&bc.cancel)) goto done;

  timers.strays = sp_tm_start_timer(); {
    bc_scan_widget_t* w = bc_scan_widget_new(bc.prompt, &bc, "Detecting unowned files", bc_strays_driver_fn);
    sp_prompt_run(bc.prompt, bc_scan_widget_as_prompt(w));

    if (w->driver_started) sp_thread_join(&w->driver);
    bc.timings.strays = sp_tm_read_timer(&timers.strays);
  }

  sp_prompt_end(bc.prompt);

done:
  bc_queue_close(&bc.write);
  sp_thread_join(&bc.writer.thread);
  bc.timings.total = bc.timings.mtree + bc.timings.alpm + bc.timings.strays;
  bc_try(bc_run_end(&bc, bc.timings.total));
  if (bc.writer.err) {
    sp_log_err("sqlite writer reported error: {.red}", sp_fmt_int(bc.writer.err));
  }

  u64 hits = 0, misses = 0, hashed = 0, errors = 0, findings = 0;
  for (u32 i = 0; i < BC_NUM_WORKERS; i++) {
    hits += bc.workers[i].hits;
    misses += bc.workers[i].misses;
    hashed += bc.workers[i].hashed;
    errors += bc.workers[i].errors;
    findings += bc.workers[i].findings;
  }

  sp_log("{:<12}: {.cyan}", sp_fmt_cstr("packages"), sp_fmt_uint(bc.num_packages));
  sp_log("{:<12}: {.cyan}", sp_fmt_cstr("files"), sp_fmt_uint(bc.num_files));
  sp_log("{:<12}: {.cyan}", sp_fmt_cstr("visited"), sp_fmt_uint(bc.num_visited));
  sp_log("{:<12}: {.cyan}", sp_fmt_cstr("stray"), sp_fmt_uint(bc.num_strays));
  sp_log("{:<12}: {.cyan}", sp_fmt_cstr("hits"), sp_fmt_uint(hits));
  sp_log("{:<12}: {.cyan}", sp_fmt_cstr("misses"), sp_fmt_uint(misses));
  sp_log("{:<12}: {.cyan}", sp_fmt_cstr("hashed"), sp_fmt_uint(hashed));
  sp_log("{:<12}: {.cyan}", sp_fmt_cstr("findings"), sp_fmt_uint(findings));
  sp_log("{:<12}: {.cyan}", sp_fmt_cstr("errors"), sp_fmt_uint(errors));
  sp_log("{:<12}: {.cyan}", sp_fmt_cstr("writes"), sp_fmt_uint(bc.writer.writes));
  sp_log("{:<12}: {.cyan .duration}", sp_fmt_cstr("t_mtree"), sp_fmt_uint(bc.timings.mtree));
  sp_log("{:<12}: {.cyan .duration}", sp_fmt_cstr("t_files"), sp_fmt_uint(bc.timings.alpm));
  sp_log("{:<12}: {.cyan .duration}", sp_fmt_cstr("t_strays"), sp_fmt_uint(bc.timings.strays));
  sp_log("{:<12}: {.cyan .duration}", sp_fmt_cstr("t_total"), sp_fmt_uint(bc.timings.total));

  //bc_print_findings_for_run(&bc);

  sp_for(it, BC_NUM_WORKERS) {
    EVP_MD_CTX_free(bc.workers[it].md_ctx);
    sp_mem_arena_destroy(bc.workers[it].arena);
  }
  sp_mem_arena_destroy(bc.work.arena);
  sp_mem_arena_destroy(bc.mtree.arena);
  alpm_release(bc.alpm);
  sqlite3_close(bc.writer.sql);
  sqlite3_close(bc.sql);
  return BC_OK;
}
