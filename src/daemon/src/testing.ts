import { beforeEach, afterEach, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { generateIdentity, identityToRecipient } from "age-encryption";
import type { Diff } from "@bicycle/shared";
import * as age from "./age";

export type Sandbox = {
  root: string;
  etc: string;
  host: string;
  state: string;
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
    fs.mkdirSync(sb.etc, { recursive: true });
    fs.mkdirSync(sb.host, { recursive: true });

    const identity = await generateIdentity();
    sb.recipient = await identityToRecipient(identity);
    const keyPath = path.join(sb.root, "age.key");
    fs.writeFileSync(keyPath, identity);

    set("BICYCLE_ETC", sb.etc);
    set("BICYCLE_HOST_ROOT", sb.host);
    set("BICYCLE_VAR", sb.state);
    set("AGE_KEY", keyPath);
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

export type Action =
  | { do: "config"; config: unknown }
  | { do: "file"; rel: string; contents: string; mode?: number }
  | { do: "age"; rel: string; plaintext: string }
  | { do: "secret"; addr: string; clear: string }
  | { do: "host"; rel: string; contents: string }
  | { do: "hostDir"; rel: string; mode?: number }
  | { do: "chmodHost"; rel: string; mode: number }
  | { do: "rm"; rel: string }
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

export const checkFs = (sb: Sandbox, checks: readonly FsCheck[]): void => {
  for (const c of checks) {
    const dest = sb.hostPath(c.path);
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
  sweep?: boolean;
  plan: readonly Partial<Diff>[];
};

export const runPlanCase = async (
  sb: Sandbox,
  mod: { all: () => Promise<void>; plan: () => Promise<Diff[]> },
  c: PlanCase,
): Promise<void> => {
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
  if (c.fs) checkFs(sb, c.fs);
  if (c.plan) expectDiffs(await mod.plan(), c.plan);
};
