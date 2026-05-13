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

void bc_ps_run(sp_mem_t mem, sp_ps_config_t config) {
  sp_ps_output_t output = sp_ps_run(mem, config);
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

  bc_ps_run(mem, (sp_ps_config_t) {
    .command = sp_str_lit("meson"),
    .args = {
      sp_str_lit("setup"),
      paths.build.pacman,
      paths.pacman,
      sp_str_lit("-Dbuildstatic=true"),
      sp_str_lit("-Ddefault_library=static"),
      sp_str_lit("-Ddoc=disabled"),
      sp_str_lit("-Ddoxygen=disabled"),
      sp_str_lit("-Di18n=false"),
      sp_str_lit("-Dgpgme=disabled"),
      sp_str_lit("-Dfile-seccomp=disabled"),
      sp_str_lit("-Dcurl=disabled"),
    },
  });

  bc_ps_run(mem, (sp_ps_config_t) {
    .command = sp_str_lit("meson"),
    .args = {
      sp_str_lit("compile"),
      sp_str_lit("-C"),
      paths.build.pacman,
      sp_str_lit("alpm_objlib"),
    },
  });

  sp_ps_config_cstr_t config = {
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
    }
  }
  bc_ps_run(mem, (sp_ps_config_t) {
    .command = sp_str_lit("cc"),
    .args = {
      sp_str_lit("-static"),
      sp_str_lit("-O2"),
      sp_str_lit("-I"), paths.libalpm,
      sp_str_lit("-I"), sp_str_lit("include"),
      paths.main,
      paths.build.objlib,
      sp_str_lit("-pthread"),
      sp_str_lit("-o"), paths.build.bin,
      sp_str_lit("-larchive"),
      sp_str_lit("-lacl"),
      sp_str_lit("-lexpat"),
      sp_str_lit("-lzstd"),
      sp_str_lit("-llz4"),
      sp_str_lit("-lbz2"),
      sp_str_lit("-lz"),
      sp_str_lit("-llzma"),
      sp_str_lit("-lssl"),
      sp_str_lit("-lcrypto"),
    },
  });

  return 0;
}
SP_MAIN(run)
