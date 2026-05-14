#!/usr/bin/env bash
# Build a custom Arch Linux live ISO that ships the web installer UI.
#
# Strategy: start from archiso's stock 'releng' profile, append our extra
# packages (archinstall comes straight from pacman), overlay our airootfs
# files, and bake the bun+hono web app under /root/web with node_modules
# pre-populated so the live system has no first-boot install cost.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-/tmp/bicycle-iso}"
CACHE="$REPO/.cache"
OVERLAY="$REPO/iso-overlay"
WEB_SRC="$REPO/src/web"
OUT="$CACHE/installer.iso"

EXTRA_PACKAGES=(
  archinstall
  bun
  openssh
)

# Fail fast with a helpful message instead of a confusing one deep in mkarchiso.
for cmd in mkarchiso bun rsync; do
  command -v "$cmd" >/dev/null || { echo "missing: $cmd"; exit 1; }
done
[ -d "$WEB_SRC" ]    || { echo "missing $WEB_SRC"; exit 1; }
[ -d "$OVERLAY" ]    || { echo "missing $OVERLAY"; exit 1; }
[ -d /usr/share/archiso/configs/releng ] || {
  echo "archiso releng profile missing — pacman -S archiso"; exit 1;
}

# Pre-install JS deps so the live ISO carries node_modules. Run as the invoking
# user, not as root, so the resulting files are owned correctly for dev sync.
(cd "$WEB_SRC" && bun install)

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

# Drop the web app under /root/web (including node_modules).
mkdir -p "$WORK"/airootfs/root/web
rsync -a --delete "$WEB_SRC"/ "$WORK"/airootfs/root/web/

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
