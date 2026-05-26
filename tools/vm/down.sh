#!/usr/bin/env bash
set -euo pipefail
NAME="${VM_NAME:-arch-installer}"
URI="${LIBVIRT_URI:-qemu:///system}"
if virsh -c "$URI" dominfo "$NAME" >/dev/null 2>&1; then
  virsh -c "$URI" destroy "$NAME" >/dev/null 2>&1 || true
  virsh -c "$URI" undefine --nvram "$NAME"
else
  echo "$NAME not defined"
fi
