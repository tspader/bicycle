#!/usr/bin/env bash
# Boot the installer ISO as a libvirt domain on the LAN bridge.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CACHE="$REPO/.cache"
NAME="${VM_NAME:-arch-installer}"
BRIDGE="${BRIDGE:-br0}"
URI="${LIBVIRT_URI:-qemu:///system}"

ISO="$CACHE/installer.iso"
TARGET="$CACHE/target.qcow2"

[ -f "$ISO" ] || { echo "missing $ISO — run 'make iso' first"; exit 1; }

if [ ! -f "$TARGET" ]; then
  qemu-img create -f qcow2 "$TARGET" 30G >/dev/null
fi

if virsh -c "$URI" dominfo "$NAME" >/dev/null 2>&1; then
  virsh -c "$URI" destroy   "$NAME" >/dev/null 2>&1 || true
  virsh -c "$URI" undefine --nvram "$NAME" >/dev/null 2>&1 || true
fi

exec virt-install \
  --connect "$URI" \
  --name "$NAME" \
  --memory 4096 \
  --vcpus 4 \
  --boot uefi \
  --cdrom "$ISO" \
  --disk path="$TARGET",bus=virtio,format=qcow2 \
  --network bridge="$BRIDGE",model=virtio \
  --osinfo archlinux \
  --graphics none \
  --console pty,target_type=serial \
  --noautoconsole
