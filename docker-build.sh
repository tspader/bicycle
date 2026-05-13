#!/usr/bin/env bash
# Compile tools/*.c with cc inside the alpm-poc container, then run the
# build driver. Artifacts under ./build are owned by the host user.

set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
pacman_src=$(readlink -f "$here/.llm/reference/pacman")

exec docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "$here:/work" \
    -v "$pacman_src:/pacman:ro" \
    -w /work \
    alpm-poc sh -c 'make -s tools && exec build/tools/build "$@"' -- "$@"
