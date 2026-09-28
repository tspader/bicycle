# bicycle pacman package

PKGBUILD for `bicycle`: one static binary that is both the daemon and the CLI,
built from the monorepo, no runtime bun dependency on the target machine.

## Build

From the repo root:

```sh
make pkg
```

This compiles `src/cli/src/main.ts` to a static binary, stages a self-contained
`.cache/pkg-work/` dir (PKGBUILD + binary + service files), runs `makepkg`
there with `BUILDDIR`/`SRCDEST`/`PKGDEST` redirected into `.cache/`, and
drops the final artifact at `build/pkg/bicycle-<ver>-1-x86_64.pkg.tar.zst`.

`tools/build-iso.sh` invokes the same script and bakes the resulting package
into the custom ISO under `/root/bicycle-pkg/`. The installer's archinstall
hook is responsible for `pacman -U`-ing it onto the target.

Do not run `makepkg` directly in this directory — the PKGBUILD expects the
prebuilt binary to be staged alongside it by `tools/src/pkg.ts`.

## Install (manual)

```sh
pacman -U bicycle-<ver>-1-x86_64.pkg.tar.zst
cp /etc/bicycle/bicycle.yml.example /etc/bicycle/bicycle.yml
$EDITOR /etc/bicycle/bicycle.yml
```

The package's post-install hook enables `bicycle.service`. Any other
units (docker, sshd, etc.) go in `bicycle.yml`'s `systemd.enable` list;
the reconciler enables them on its next run.

The daemon and the CLI both read `/etc/bicycle.json`, which is optional. It
names the tree when it is not `/etc/bicycle` and the ports when they are not
7777 (API) and 8081 (web UI):

```json
{ "etc": "/home/me/machine", "port": 7778 }
```

## Files installed

- `/usr/bin/bicycle` — the daemon and the CLI
- `/usr/lib/systemd/system/bicycle.service` — runs `bicycle daemon run`
- `/etc/bicycle/bicycle.yml.example` — sample machine spec
