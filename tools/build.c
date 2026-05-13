#define SP_IMPLEMENTATION
#include "sp.h"

typedef struct {
  sp_str_t cwd;
  sp_str_t pacman;
  sp_str_t out;
  sp_str_t pacman_build;
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
    .out = sp_os_env_get(sp_str_lit("OUT_DIR")),
  };
  if (sp_str_empty(paths.pacman)) paths.pacman = sp_str_lit("/pacman");
  if (sp_str_empty(paths.out))    paths.out = sp_fs_join_path(mem, paths.cwd, sp_str_lit("build"));

  if (!sp_fs_is_target_dir(paths.pacman)) {
    sp_log_err("PACMAN_SRC={.red} is not a directory", sp_fmt_str(paths.pacman));
    return 1;
  }

  sp_fs_create_dir(paths.out);
  paths.pacman_build = sp_fs_join_path(mem, paths.out, sp_str_lit("pacman-build"));

  sp_log("pacman:       {.cyan}", sp_fmt_str(paths.pacman));
  sp_log("out:          {.cyan}", sp_fmt_str(paths.out));
  sp_log("pacman_build: {.cyan}", sp_fmt_str(paths.pacman_build));

  sp_str_t build_ninja = sp_fs_join_path(mem, paths.pacman_build, sp_str_lit("build.ninja"));
  if (!sp_fs_exists(build_ninja)) {
    sp_ps_config_t ps = { .command = sp_str_lit("meson") };
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("setup"));
    sp_ps_config_add_arg(mem, &ps, paths.pacman_build);
    sp_ps_config_add_arg(mem, &ps, paths.pacman);
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-Dbuildstatic=true"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-Ddefault_library=static"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-Ddoc=disabled"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-Ddoxygen=disabled"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-Di18n=false"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-Dgpgme=disabled"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-Dfile-seccomp=disabled"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-Dcurl=disabled"));
    bc_ps_run(mem, ps);
  }

  {
    sp_ps_config_t ps = { .command = sp_str_lit("meson") };
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("compile"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-C"));
    sp_ps_config_add_arg(mem, &ps, paths.pacman_build);
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("alpm_objlib"));
    bc_ps_run(mem, ps);
  }

  sp_da(sp_str_t) pkg_libs = SP_NULLPTR;
  sp_da_init(mem, pkg_libs);
  {
    sp_ps_config_t ps = { .command = sp_str_lit("pkg-config") };
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("--static"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("--libs"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("libarchive"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("openssl"));
    bc_ps_run(mem, ps);
    // sp_ps_output_t out = sp_ps_run(mem, ps);
    // if (out.status.exit_code != 0) {
    //   sp_log_err("pkg-config failed: {.red}", sp_fmt_str(out.err));
    //   return 1;
    // }
    // sp_da(sp_str_t) parts = sp_str_split_c8(mem, sp_str_trim(out.out), ' ');
    // sp_da_for(parts, i) {
    //   sp_str_t p = sp_str_trim(parts[i]);
    //   if (!sp_str_empty(p)) sp_da_push(pkg_libs, p);
    // }
  }

  {
    sp_ps_config_t ps = { .command = sp_str_lit("cc") };
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-static"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-O2"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-Wall"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-Wextra"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-I"));
    sp_ps_config_add_arg(mem, &ps, sp_fs_join_path(mem, paths.pacman, sp_str_lit("lib/libalpm")));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-I"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("include"));
    sp_ps_config_add_arg(mem, &ps, sp_fs_join_path(mem, paths.cwd, sp_str_lit("src/main.c")));
    sp_ps_config_add_arg(mem, &ps, sp_fs_join_path(mem, paths.pacman_build, sp_str_lit("libalpm_objlib.a")));
    sp_da_for(pkg_libs, i) sp_ps_config_add_arg(mem, &ps, pkg_libs[i]);
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-pthread"));
    sp_ps_config_add_arg(mem, &ps, sp_str_lit("-o"));
    sp_ps_config_add_arg(mem, &ps, sp_fs_join_path(mem, paths.out, sp_str_lit("alpm-poc")));
    bc_ps_run(mem, ps);
  }

  return 0;
}
SP_MAIN(run)
