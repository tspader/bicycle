#define SP_IMPLEMENTATION
#include "sp.h"
// here=$(cd "$(dirname "$0")" && pwd)
//
// PACMAN_SRC=${PACMAN_SRC:-/pacman}
// OUT_DIR=${OUT_DIR:-$here/build}
//
// if [[ ! -d $PACMAN_SRC ]]; then
//     echo "PACMAN_SRC=$PACMAN_SRC is not a directory" >&2
//     exit 1
// fi
// PACMAN_SRC=$(cd "$PACMAN_SRC" && pwd)
//
// mkdir -p "$OUT_DIR"
// OUT_DIR=$(cd "$OUT_DIR" && pwd)
//
// pacman_build=$OUT_DIR/pacman-build
//
// if [[ ! -f $pacman_build/build.ninja ]]; then
//     meson setup "$pacman_build" "$PACMAN_SRC" \
//         -Dbuildstatic=true \
//         -Ddefault_library=static \
//         -Ddoc=disabled \
//         -Ddoxygen=disabled \
//         -Di18n=false \
//         -Dgpgme=disabled \
//         -Dfile-seccomp=disabled \
//         -Dcurl=disabled
// fi
//
// meson compile -C "$pacman_build" alpm_objlib
//
// cc -static -O2 -Wall -Wextra \
//     -I "$PACMAN_SRC/lib/libalpm" \
//     "$here/main.c" \
//     "$pacman_build/libalpm_objlib.a" \
//     $(pkg-config --static --libs libarchive openssl) \
//     -pthread \
//     -o "$OUT_DIR/alpm-poc"
//
// strip "$OUT_DIR/alpm-poc"
// file "$OUT_DIR/alpm-poc"
// ls -lh "$OUT_DIR/alpm-poc"

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
