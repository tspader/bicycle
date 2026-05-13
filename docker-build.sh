#!/usr/bin/env bash
# Run build.sh inside the alpm-poc container as the host user, so artifacts
# under ./build are owned by you and not root.

set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
pacman_src=$(readlink -f "$here/.llm/reference/pacman")

exec docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "$here:/work" \
    -v "$pacman_src:/pacman:ro" \
    -w /work \
    alpm-poc ./build.sh "$@"
