#!/usr/bin/env bash
NAME="${VM_NAME:-arch-installer}"
URI="${LIBVIRT_URI:-qemu:///system}"
exec virsh -c "$URI" console "$NAME"
