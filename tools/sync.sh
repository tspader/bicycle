#!/usr/bin/env bash
# Push local web/ changes into the running VM and restart the server.
# Skips node_modules — those came from the ISO build and stay put.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
VM_HOST="${VM_HOST:-arch-installer.local}"
VM_PORT="${VM_PORT:-22}"
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)

rsync -a --delete --exclude='node_modules' \
  -e "ssh -p $VM_PORT ${SSH_OPTS[*]}" \
  "$REPO/src/installer/" \
  "root@$VM_HOST:/root/web/"

ssh -p "$VM_PORT" "${SSH_OPTS[@]}" "root@$VM_HOST" 'systemctl restart installer-web'
echo "synced + restarted"
