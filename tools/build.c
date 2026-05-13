#define SP_IMPLEMENTATION
#include "sp.h"

typedef struct {
  sp_str_t cwd;
  sp_str_t pacman;
  sp_str_t build;
} bc_paths_t;

s32 run(s32 num_args, const c8** args) {
  sp_mem_t mem = sp_mem_os_new();

  bc_paths_t paths = {
    .cwd = sp_fs_get_cwd(mem),
    .pacman = sp_os_env_get(sp_str_lit("PACMAN_SRC")),
    .build = sp_os_env_get(sp_str_lit("OUT_DIR")),
  };
  if (sp_str_empty(paths.pacman)) paths.pacman = sp_str_lit("/var/lib/pacman");
  if (sp_str_empty(paths.build)) paths.build = sp_fs_join_path(mem, paths.cwd, sp_str_lit("build"));

  sp_log("hello, {.cyan}!", sp_fmt_cstr("world"));
  sp_log("pacman: {.cyan}!", sp_fmt_str(paths.pacman));
  sp_log("build: {.cyan}!", sp_fmt_str(paths.build));
  return 0;
}
SP_MAIN(run)
