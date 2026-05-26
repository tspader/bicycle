#!/usr/bin/env bash
# Build a custom Arch Linux live ISO that ships the web installer UI.
#
# Strategy: start from archiso's stock 'releng' profile, append our extra
# packages, overlay our airootfs files, and drop the prebuilt single-file
# installer binary into /usr/local/bin.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-/tmp/bicycle-iso}"
CACHE="$REPO/.cache"
OVERLAY="$REPO/iso-overlay"
BINARY="$REPO/src/installer/dist/bicycle"
OUT="$CACHE/installer.iso"

EXTRA_PACKAGES=(
  archinstall
  openssh
)

# Fail fast with a helpful message instead of a confusing one deep in mkarchiso.
for cmd in mkarchiso rsync; do
  command -v "$cmd" >/dev/null || { echo "missing: $cmd"; exit 1; }
done
[ -f "$BINARY" ]  || { echo "missing $BINARY — build the web app first"; exit 1; }
[ -d "$OVERLAY" ] || { echo "missing $OVERLAY"; exit 1; }
[ -d /usr/share/archiso/configs/releng ] || {
  echo "archiso releng profile missing — pacman -S archiso"; exit 1;
}

# Everything from here on writes into $WORK / $OUT, both of which need root
# (mkarchiso pacstraps a chroot). Re-exec under sudo if not already root.
if [ "$EUID" -ne 0 ]; then
  exec sudo --preserve-env=WORK,USER "$0" "$@"
fi

mkdir -p "$CACHE"
rm -rf "$WORK"
mkdir -p "$WORK"

# Lay down archiso's releng profile as the base.
cp -a /usr/share/archiso/configs/releng/. "$WORK"/

# Append our extras to the package list.
printf '%s\n' "${EXTRA_PACKAGES[@]}" >> "$WORK/packages.x86_64"

# Overlay our files (hostname, sshd config, systemd unit) onto airootfs.
rsync -a "$OVERLAY"/ "$WORK"/airootfs/

# Drop the prebuilt single-file installer binary into /usr/local/bin.
# archiso resets airootfs perms unless the path is in profiledef's
# `file_permissions` array. profiledef.sh is sourced bash, so append the
# entry as a normal array assignment.
install -D -m 755 "$BINARY" "$WORK"/airootfs/usr/local/bin/bicycle
echo 'file_permissions["/usr/local/bin/bicycle"]="0:0:755"' >> "$WORK"/profiledef.sh

# Authorize the invoking user's SSH keys for root login on the live system.
INVOKING_USER="${SUDO_USER:-$USER}"
USER_HOME="$(getent passwd "$INVOKING_USER" | cut -d: -f6)"
install -d -m 700 "$WORK"/airootfs/root/.ssh
cat "$USER_HOME"/.ssh/*.pub > "$WORK"/airootfs/root/.ssh/authorized_keys
chmod 600 "$WORK"/airootfs/root/.ssh/authorized_keys

# Enable our service (archiso doesn't run `systemctl enable` for us).
install -d "$WORK"/airootfs/etc/systemd/system/multi-user.target.wants
ln -sf /etc/systemd/system/installer-web.service \
  "$WORK"/airootfs/etc/systemd/system/multi-user.target.wants/installer-web.service

# Build.
mkarchiso -v -w "$WORK/work" -o "$WORK/out" "$WORK"

# Publish the ISO into .cache, owned by the invoking user.
BUILT="$(ls -t "$WORK"/out/*.iso | head -1)"
install -m 644 -o "$INVOKING_USER" -g "$INVOKING_USER" "$BUILT" "$OUT"
echo "built: $OUT"
