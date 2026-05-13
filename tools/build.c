#define SP_IMPLEMENTATION
#define SP_PS_MAX_ARGS 32
#include "sp.h"

typedef struct {
  sp_str_t cwd;
  sp_str_t pacman;
  sp_str_t libalpm;
  sp_str_t main;
  struct {
    sp_str_t dir;
    sp_str_t pacman;
    sp_str_t objlib;
    sp_str_t bin;
  } build;
} bc_paths_t;

void bc_ps_run(sp_mem_t mem, sp_ps_config_cstr_t config) {
  sp_ps_output_t output = sp_ps_run_cstr(mem, config);
  if (output.status.exit_code) {
    sp_os_print_err(output.err);
    sp_os_print_err(sp_str_lit("\n"));
    exit(output.status.exit_code);
  }
}

s32 run(s32 num_args, const c8** args) {
  sp_mem_t mem = sp_mem_os_new();

  bc_paths_t paths = {
    .cwd = sp_fs_get_cwd(mem),
    .pacman = sp_os_env_get(sp_str_lit("PACMAN_SRC")),
    .build.dir = sp_os_env_get(sp_str_lit("OUT_DIR")),
  };
  if (sp_str_empty(paths.pacman)) {
    paths.pacman = sp_str_lit("/pacman");
  }
  if (sp_str_empty(paths.build.dir)) {
    paths.build.dir = sp_fs_join_path(mem, paths.cwd, sp_str_lit("build"));
  }

  paths.build.pacman = sp_fs_join_path(mem, paths.build.dir, sp_str_lit("pacman"));
  paths.build.objlib = sp_fs_join_path(mem, paths.build.pacman, sp_str_lit("libalpm_objlib.a"));
  paths.build.bin = sp_fs_join_path(mem, paths.build.dir, sp_str_lit("alpm-poc"));
  paths.libalpm = sp_fs_join_path(mem, paths.pacman, sp_str_lit("lib/libalpm"));
  paths.main = sp_fs_join_path(mem, paths.cwd, sp_str_lit("src/main.c"));

  if (!sp_fs_is_target_dir(paths.pacman)) {
    sp_log_err("PACMAN_SRC={.red} is not a directory", sp_fmt_str(paths.pacman));
    return 1;
  }

  sp_fs_create_dir(paths.build.dir);

  sp_log("{:<12} {.cyan}", sp_fmt_cstr("pacman:"), sp_fmt_str(paths.pacman));
  sp_log("{:<12} {.cyan}", sp_fmt_cstr("build:"), sp_fmt_str(paths.build.dir));

  bc_ps_run(mem, (sp_ps_config_cstr_t) {
    .command = "meson",
    .args = {
      "setup",
      sp_str_to_cstr(mem, paths.build.pacman),
      sp_str_to_cstr(mem, paths.pacman),
      "-Dbuildstatic=true",
      "-Ddefault_library=static",
      "-Ddoc=disabled",
      "-Ddoxygen=disabled",
      "-Di18n=false",
      "-Dgpgme=disabled",
      "-Dfile-seccomp=disabled",
      "-Dcurl=disabled",
    },
  });

  bc_ps_run(mem, (sp_ps_config_cstr_t) {
    .command = "meson",
    .args = {
      "compile",
      "-C",
      sp_str_to_cstr(mem, paths.build.pacman),
      "alpm_objlib",
    },
  });

  bc_ps_run(mem, (sp_ps_config_cstr_t) {
    .command = "cc",
    .args = {
      "-static",
      "-O2",
      "-I", sp_str_to_cstr(mem, paths.libalpm),
      "-I", "include",
      sp_str_to_cstr(mem, paths.main),
      sp_str_to_cstr(mem, paths.build.objlib),
      "-pthread",
      "-o", sp_str_to_cstr(mem, paths.build.bin),
      "-larchive",
      "-lacl",
      "-lexpat",
      "-lzstd",
      "-llz4",
      "-lbz2",
      "-lz",
      "-llzma",
      "-lssl",
      "-lcrypto",
    },
  });

  return 0;
}
SP_MAIN(run)
