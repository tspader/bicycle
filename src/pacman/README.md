# bicycle pacman package

PKGBUILD for the `bicycle` daemon. Builds a static binary from the monorepo,
no runtime bun dependency on the target machine.

## Build

From the repo root:

```sh
bun tools/pkg.ts
```

This compiles the daemon to a static binary, stages a self-contained
`.cache/pkg-work/` dir (PKGBUILD + binary + service files), runs `makepkg`
there with `BUILDDIR`/`SRCDEST`/`PKGDEST` redirected into `.cache/`, and
drops the final artifact at `build/pkg/bicycle-<ver>-1-x86_64.pkg.tar.zst`.

`tools/build-iso.sh` invokes the same script and bakes the resulting package
into the custom ISO under `/root/bicycle-pkg/`. The installer's archinstall
hook is responsible for `pacman -U`-ing it onto the target.

Do not run `makepkg` directly in this directory — the PKGBUILD expects the
prebuilt binary to be staged alongside it by `tools/pkg.ts`.

## Install (manual)

```sh
pacman -U bicycle-<ver>-1-x86_64.pkg.tar.zst
cp /etc/bicycle/bicycle.yml.example /etc/bicycle/bicycle.yml
$EDITOR /etc/bicycle/bicycle.yml
```

The package's post-install hook enables `bicycle-reconcile.timer`. Any other
units (docker, sshd, etc.) go in `bicycle.yml`'s `systemd.enable` list;
the reconciler enables them on its next run.

## Files installed

- `/usr/bin/bicycle` — compiled daemon binary
- `/usr/lib/systemd/system/bicycle.service` — long-running daemon
- `/usr/lib/systemd/system/bicycle-reconcile.service` — oneshot reconciler
- `/etc/bicycle/bicycle.yml.example` — sample machine spec
