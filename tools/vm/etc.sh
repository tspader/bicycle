#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="${SRC:-$REPO/example/machine}"
DEST="${DEST:-/etc/bicycle}"
VM_HOST="${VM_HOST:-arch-installer.local}"
VM_PORT="${VM_PORT:-22}"
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)

[ -d "$SRC" ] || { echo "missing $SRC"; exit 1; }

ssh -p "$VM_PORT" "${SSH_OPTS[@]}" "root@$VM_HOST" "mkdir -p $DEST"

rsync -a --delete \
  -e "ssh -p $VM_PORT ${SSH_OPTS[*]}" \
  "$SRC/" \
  "root@$VM_HOST:$DEST/"

echo "pushed $SRC -> root@$VM_HOST:$DEST"
