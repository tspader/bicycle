#!/usr/bin/env bash

set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)

PACMAN_SRC=${PACMAN_SRC:-/pacman}
OUT_DIR=${OUT_DIR:-$here/build}

if [[ ! -d $PACMAN_SRC ]]; then
    echo "PACMAN_SRC=$PACMAN_SRC is not a directory" >&2
    exit 1
fi
PACMAN_SRC=$(cd "$PACMAN_SRC" && pwd)

mkdir -p "$OUT_DIR"
OUT_DIR=$(cd "$OUT_DIR" && pwd)

pacman_build=$OUT_DIR/pacman-build

if [[ ! -f $pacman_build/build.ninja ]]; then
    meson setup "$pacman_build" "$PACMAN_SRC" \
        -Dbuildstatic=true \
        -Ddefault_library=static \
        -Ddoc=disabled \
        -Ddoxygen=disabled \
        -Di18n=false \
        -Dgpgme=disabled \
        -Dfile-seccomp=disabled \
        -Dcurl=disabled
fi

meson compile -C "$pacman_build" alpm_objlib

cc -static -O2 -Wall -Wextra \
    -I "$PACMAN_SRC/lib/libalpm" \
    -I include \
    "$here/src/main.c" \
    "$pacman_build/libalpm_objlib.a" \
    $(pkg-config --static --libs libarchive openssl) \
    -pthread \
    -o "$OUT_DIR/alpm-poc"

strip "$OUT_DIR/alpm-poc"
file "$OUT_DIR/alpm-poc"
ls -lh "$OUT_DIR/alpm-poc"
