#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="${VM_NAME:-arch-installer}"
URI="${LIBVIRT_URI:-qemu:///system}"
OUT="$REPO/.env.vm"

IP="$(virsh -c "$URI" domifaddr "$NAME" --source arp | awk '/ipv4/ {print $4}' | cut -d/ -f1 | head -1)"

if [ -z "$IP" ]; then
  echo "no IP found for $NAME (ARP cache empty?)" >&2
  exit 1
fi

printf 'export BICYCLE_VM_IP="%s"\n' "$IP" > "$OUT"
echo "wrote $OUT: BICYCLE_VM_IP=$IP"
