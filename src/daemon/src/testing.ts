import { beforeEach, afterEach, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { generateIdentity, identityToRecipient } from "age-encryption";
import type { Diff } from "@bicycle/shared";
import * as age from "./age";
import * as ports from "./ports";

export type Sandbox = {
  root: string;
  etc: string;
  host: string;
  state: string;
  bin: string;
  fixtures: string;
  recipient: string;
  etcPath: (rel: string) => string;
  hostPath: (rel: string) => string;
};

export const useSandbox = (): Sandbox => {
  const sb: Sandbox = {
    root: "",
    etc: "",
    host: "",
    state: "",
    bin: "",
    fixtures: "",
    recipient: "",
    etcPath: (rel) => path.join(sb.etc, rel),
    hostPath: (rel) => path.join(sb.host, rel),
  };
  let saved: Record<string, string | undefined> = {};
  const set = (k: string, v: string) => {
    saved[k] = process.env[k];
    process.env[k] = v;
  };

  beforeEach(async () => {
    sb.root = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-test-"));
    sb.etc = path.join(sb.root, "etc");
    sb.host = path.join(sb.root, "host");
    sb.state = path.join(sb.root, "var");
    sb.bin = path.join(sb.root, "bin");
    sb.fixtures = path.join(sb.root, "fixtures");
    fs.mkdirSync(sb.etc, { recursive: true });
    fs.mkdirSync(sb.host, { recursive: true });
    fs.mkdirSync(sb.bin, { recursive: true });
    fs.mkdirSync(sb.fixtures, { recursive: true });
    defaultShims(sb);

    const identity = await generateIdentity();
    sb.recipient = await identityToRecipient(identity);
    const keyPath = path.join(sb.root, "age.key");
    fs.writeFileSync(keyPath, identity);

    set("BICYCLE_ETC", sb.etc);
    set("BICYCLE_HOST_ROOT", sb.host);
    set("BICYCLE_VAR", sb.state);
    set("AGE_KEY", keyPath);
    set("PATH", `${sb.bin}:${process.env.PATH ?? ""}`);
  });

  afterEach(() => {
    fs.rmSync(sb.root, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    saved = {};
  });

  return sb;
};

export const writeConfig = (sb: Sandbox, config: unknown): void => {
  const text = typeof config === "string" ? config : Bun.YAML.stringify(config);
  fs.writeFileSync(path.join(sb.etc, "bicycle.yml"), text);
};

const writeEtc = (
  sb: Sandbox,
  rel: string,
  contents: string | Uint8Array,
  mode?: number,
): void => {
  const p = sb.etcPath(rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contents);
  if (mode !== undefined) fs.chmodSync(p, mode);
};

export const writeSecret = async (
  sb: Sandbox,
  addr: string,
  clear: string,
): Promise<void> => {
  const ct = await age.encrypt(new TextEncoder().encode(clear), [sb.recipient]);
  writeEtc(sb, path.join("secrets", `${addr}.age`), ct);
};

export const writeShim = (sb: Sandbox, name: string, script: string): void => {
  fs.writeFileSync(path.join(sb.bin, name), script, { mode: 0o755 });
};

const defaultShims = (sb: Sandbox): void => {
  const fx = sb.fixtures;
  writeShim(
    sb,
    "pacman",
    `#!/bin/sh
case "$1" in
  -Qq) cat "${fx}/pacman.installed" 2>/dev/null; exit 0;;
  -Qen) cat "${fx}/pacman.explicit" 2>/dev/null; exit 0;;
  -Qem) cat "${fx}/pacman.foreign" 2>/dev/null; exit 0;;
  -Qi) grep -qxF -- "$2" "${fx}/pacman.installed" 2>/dev/null && exit 0; exit 1;;
  *) exit 1;;
esac
`,
  );
  writeShim(
    sb,
    "systemctl",
    `#!/bin/sh
scope=systemd
if [ "$1" = "--user" ] && [ "$2" = "-M" ]; then scope="systemd.user.\${3%@}"; shift 3; fi
case "$1" in
  is-enabled) grep -qxF -- "$2" "${fx}/\${scope}.enabled" 2>/dev/null && exit 0; exit 1;;
  is-active) grep -qxF -- "$2" "${fx}/\${scope}.active" 2>/dev/null && exit 0; exit 1;;
  list-unit-files) cat "${fx}/\${scope}.unit-files.json" 2>/dev/null || echo "[]"; exit 0;;
  daemon-reload) exit 0;;
  *) exit 1;;
esac
`,
  );
  writeShim(
    sb,
    "docker",
    `#!/bin/sh
for a; do last=$a; done
case "$1" in
  inspect)
    if [ "$last" = bicycle-ingress ]; then
      if [ -f "${fx}/docker.status" ]; then cat "${fx}/docker.status"; exit 0; fi
      echo "Error: No such object: bicycle-ingress" >&2; exit 1
    fi;;
  compose)
    prev=
    for a; do
      if [ "$prev" = -p ]; then project=$a; fi
      prev=$a
    done
    for a; do
      if [ "$a" = up ]; then
        touch "$BICYCLE_HOST_ROOT/docker-up"
        echo running > "${fx}/docker.status"
        exit 0
      fi
      if [ "$a" = down ]; then
        touch "$BICYCLE_HOST_ROOT/docker-down-$project"
        exit 0
      fi
    done;;
  exec)
    if [ "$2" = bicycle-ingress ] && [ "$3" = caddy ] && [ "$4" = reload ]; then
      touch "$BICYCLE_HOST_ROOT/docker-reload"; exit 0
    fi;;
  network) exit 0;;
esac
exec /usr/bin/docker "$@"
`,
  );
  writeShim(
    sb,
    "getent",
    `#!/bin/sh
case "$1" in
  passwd|group)
    if [ "$#" -eq 1 ]; then cat "${fx}/$1" 2>/dev/null; exit 0; fi
    line=$(grep -m1 "^$2:" "${fx}/$1" 2>/dev/null) && { echo "$line"; exit 0; }
    ;;
esac
exec /usr/bin/getent "$@"
`,
  );
};

export type SystemState = {
  installed?: string[];
  explicit?: string[];
  foreign?: string[];
  enabled?: string[];
  active?: string[];
  unitFiles?: { unit_file: string; state: string; preset: string | null }[];
  userManagers?: Record<string, {
    enabled?: string[];
    active?: string[];
    unitFiles?: { unit_file: string; state: string; preset: string | null }[];
  }>;
  users?: { name: string; uid: number }[];
  groups?: { name: string; gid: number }[];
  ingress?: { status: string };
};

export const writeSystem = (sb: Sandbox, sys: SystemState): void => {
  const write = (name: string, lines: string[]) =>
    fs.writeFileSync(path.join(sb.fixtures, name), lines.map((l) => `${l}\n`).join(""));
  if (sys.installed) write("pacman.installed", sys.installed);
  if (sys.explicit) write("pacman.explicit", sys.explicit.map((p) => `${p} 1.0-1`));
  if (sys.foreign) write("pacman.foreign", sys.foreign.map((p) => `${p} 1.0-1`));
  if (sys.enabled) write("systemd.enabled", sys.enabled);
  if (sys.active) write("systemd.active", sys.active);
  if (sys.unitFiles) write("systemd.unit-files.json", [JSON.stringify(sys.unitFiles)]);
  for (const [user, m] of Object.entries(sys.userManagers ?? {})) {
    if (m.enabled) write(`systemd.user.${user}.enabled`, m.enabled);
    if (m.active) write(`systemd.user.${user}.active`, m.active);
    if (m.unitFiles) write(`systemd.user.${user}.unit-files.json`, [JSON.stringify(m.unitFiles)]);
  }
  if (sys.users) {
    write("passwd", sys.users.map((u) => `${u.name}:x:${u.uid}:${u.uid}::/home/${u.name}:/bin/bash`));
  }
  if (sys.groups) write("group", sys.groups.map((g) => `${g.name}:x:${g.gid}:`));
  if (sys.ingress) write("docker.status", [sys.ingress.status]);
};

export type Action =
  | { do: "config"; config: unknown }
  | { do: "file"; rel: string; contents: string; mode?: number }
  | { do: "age"; rel: string; plaintext: string }
  | { do: "secret"; addr: string; clear: string }
  | { do: "host"; rel: string; contents: string }
  | { do: "hostDir"; rel: string; mode?: number }
  | { do: "chmodHost"; rel: string; mode: number }
  | { do: "rm"; rel: string }
  | { do: "shim"; name: string; script: string }
  | { do: "system"; system: SystemState }
  | { do: "app"; name: string; config: unknown }
  | { do: "ports"; store: ports.Store }
  | { do: "state"; rel: string; contents: string }
  | { do: "sweep" };

export const runActions = async (
  sb: Sandbox,
  actions: readonly Action[],
  sweep: () => Promise<void>,
): Promise<void> => {
  for (const a of actions) {
    switch (a.do) {
      case "config":
        writeConfig(sb, a.config);
        break;
      case "file":
        writeEtc(sb, path.join("files", a.rel), a.contents, a.mode ?? 0o644);
        break;
      case "age": {
        const ct = await age.encrypt(new TextEncoder().encode(a.plaintext), [sb.recipient]);
        writeEtc(sb, path.join("files", a.rel), ct, 0o644);
        break;
      }
      case "secret":
        await writeSecret(sb, a.addr, a.clear);
        break;
      case "host": {
        const p = sb.hostPath(a.rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, a.contents);
        break;
      }
      case "hostDir": {
        const p = sb.hostPath(a.rel);
        fs.mkdirSync(p, { recursive: true });
        if (a.mode !== undefined) fs.chmodSync(p, a.mode);
        break;
      }
      case "chmodHost":
        fs.chmodSync(sb.hostPath(a.rel), a.mode);
        break;
      case "rm":
        fs.rmSync(sb.etcPath(path.join("files", a.rel)));
        break;
      case "shim":
        writeShim(sb, a.name, a.script);
        break;
      case "system":
        writeSystem(sb, a.system);
        break;
      case "app":
        writeEtc(
          sb,
          path.join("apps", a.name, "config.yml"),
          typeof a.config === "string" ? a.config : Bun.YAML.stringify(a.config),
        );
        break;
      case "ports":
        ports.write(a.store);
        break;
      case "state": {
        const p = path.join(sb.state, a.rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, a.contents);
        break;
      }
      case "sweep":
        await sweep();
        break;
    }
  }
};

export type FsCheck = {
  path: string;
  contents?: string;
  mode?: number;
  linkTo?: string;
  dir?: boolean;
  absent?: boolean;
};

export const checkFs = (base: string, checks: readonly FsCheck[]): void => {
  for (const c of checks) {
    const dest = path.join(base, c.path);
    let st: fs.Stats | null = null;
    try { st = fs.lstatSync(dest); } catch {}
    if (c.absent) {
      expect(st).toBeNull();
      continue;
    }
    expect(st).not.toBeNull();
    if (c.dir) expect(st!.isDirectory()).toBe(true);
    if (c.linkTo !== undefined) {
      expect(st!.isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(dest)).toBe(c.linkTo);
    }
    if (c.contents !== undefined) {
      expect(fs.readFileSync(dest, "utf8")).toBe(c.contents);
    }
    if (c.mode !== undefined) {
      expect(st!.mode & 0o7777).toBe(c.mode);
    }
  }
};

export const expectDiffs = (
  actual: readonly Diff[],
  want: readonly Partial<Diff>[],
): void => {
  expect(actual).toHaveLength(want.length);
  for (let i = 0; i < want.length; i++) {
    expect(actual[i]).toMatchObject(want[i]!);
    expect(actual[i]!.redacted).toBe(want[i]!.redacted as boolean | undefined);
  }
};

export const backdate = (p: string): number => {
  const old = new Date(fs.statSync(p).mtimeMs - 60_000);
  fs.utimesSync(p, old, old);
  return fs.statSync(p).mtimeMs;
};

export type PlanCase = {
  name: string;
  config?: unknown;
  system?: SystemState;
  sweep?: boolean;
  plan: readonly Partial<Diff>[];
};

export const runPlanCase = async (
  sb: Sandbox,
  mod: { all: () => Promise<void>; plan: () => Promise<Diff[]> },
  c: PlanCase,
): Promise<void> => {
  if (c.system !== undefined) writeSystem(sb, c.system);
  if (c.config !== undefined) writeConfig(sb, c.config);
  if (c.sweep) await mod.all();
  expectDiffs(await mod.plan(), c.plan);
};

export type ReconcilerCase = {
  name: string;
  needs?: "visudo";
  skipIf?: boolean;
  actions: readonly Action[];
  rejects?: RegExp | true;
  fs?: readonly FsCheck[];
  state?: readonly FsCheck[];
  ports?: ports.Store;
  plan?: readonly Partial<Diff>[];
};

export const runReconcilerCase = async (
  sb: Sandbox,
  mod: { plan: () => Promise<Diff[]> },
  sweep: () => Promise<void>,
  c: ReconcilerCase,
): Promise<void> => {
  if (c.rejects) {
    const matcher = expect(runActions(sb, c.actions, sweep)).rejects;
    await (c.rejects === true ? matcher.toThrow() : matcher.toThrow(c.rejects));
    return;
  }
  await runActions(sb, c.actions, sweep);
  if (c.fs) checkFs(sb.host, c.fs);
  if (c.state) checkFs(sb.state, c.state);
  if (c.ports) expect(ports.read()).toEqual(c.ports);
  if (c.plan) expectDiffs(await mod.plan(), c.plan);
};
