#!/usr/bin/env bash
VM_HOST="${VM_HOST:-arch-installer.local}"
VM_PORT="${VM_PORT:-22}"
exec ssh \
  -p "$VM_PORT" \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o LogLevel=ERROR \
  "root@$VM_HOST" "$@"
