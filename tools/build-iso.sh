#!/usr/bin/env bash
# Build a custom Arch Linux live ISO that ships the web installer UI.
#
# Strategy: start from archiso's stock 'releng' profile, append our extra
# packages (archinstall comes straight from pacman), overlay our airootfs
# files, and bake the bicycle monorepo under /root/bicycle with node_modules
# pre-populated so the live system has no first-boot install cost.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-/tmp/bicycle-iso}"
CACHE="$REPO/.cache"
OVERLAY="$REPO/iso-overlay"
OUT="$CACHE/installer.iso"

EXTRA_PACKAGES=(
  archinstall
  bun
  git
  openssh
  sudo
)

for cmd in mkarchiso bun rsync makepkg; do
  command -v "$cmd" >/dev/null || { echo "missing: $cmd"; exit 1; }
done
[ -d "$REPO/src/installer" ] || { echo "missing $REPO/src/installer"; exit 1; }
[ -d "$REPO/src/shared" ]    || { echo "missing $REPO/src/shared"; exit 1; }
[ -d "$REPO/src/pacman" ]    || { echo "missing $REPO/src/pacman"; exit 1; }
[ -d "$OVERLAY" ]            || { echo "missing $OVERLAY"; exit 1; }
[ -d /usr/share/archiso/configs/releng ] || {
  echo "archiso releng profile missing — pacman -S archiso"; exit 1;
}

PKG_OUT="$REPO/build/pkg"

if [ "$EUID" -ne 0 ]; then
  (cd "$REPO" && bun install)
  (cd "$REPO" && bun tools/src/pkg.ts)
  exec sudo --preserve-env=WORK,USER "$0" "$@"
fi

mkdir -p "$CACHE"
rm -rf "$WORK"
mkdir -p "$WORK"

cp -a /usr/share/archiso/configs/releng/. "$WORK"/

printf '%s\n' "${EXTRA_PACKAGES[@]}" >> "$WORK/packages.x86_64"

rsync -a "$OVERLAY"/ "$WORK"/airootfs/

# Drop the bicycle workspace under /root/bicycle. Include root package.json,
# bun.lock, tsconfig, and the shared + installer packages with their
# node_modules. Skip everything else (poller C code, daemon, tests, etc.).
mkdir -p "$WORK"/airootfs/root/bicycle
rsync -a \
  --include='/package.json' \
  --include='/bun.lock' \
  --include='/tsconfig.json' \
  --include='/node_modules/***' \
  --include='/src/' \
  --include='/src/shared/***' \
  --include='/src/installer/***' \
  --exclude='*' \
  --exclude='.playwright-cli' \
  --exclude='.playwright-mcp' \
  --exclude='.llm' \
  --exclude='dist' \
  --exclude='tests' \
  "$REPO"/ "$WORK"/airootfs/root/bicycle/

INVOKING_USER="${SUDO_USER:-$USER}"
USER_HOME="$(getent passwd "$INVOKING_USER" | cut -d: -f6)"
install -d -m 700 "$WORK"/airootfs/root/.ssh
cat "$USER_HOME"/.ssh/*.pub > "$WORK"/airootfs/root/.ssh/authorized_keys
chmod 600 "$WORK"/airootfs/root/.ssh/authorized_keys

install -d "$WORK"/airootfs/etc/systemd/system/multi-user.target.wants
ln -sf /etc/systemd/system/installer-web.service \
  "$WORK"/airootfs/etc/systemd/system/multi-user.target.wants/installer-web.service

install -d "$WORK"/airootfs/root/bicycle-pkg
cp "$PKG_OUT"/bicycle-*.pkg.tar.zst "$WORK"/airootfs/root/bicycle-pkg/

mkarchiso -v -w "$WORK/work" -o "$WORK/out" "$WORK"

BUILT="$(ls -t "$WORK"/out/*.iso | head -1)"
install -m 644 -o "$INVOKING_USER" -g "$INVOKING_USER" "$BUILT" "$OUT"
echo "built: $OUT"
