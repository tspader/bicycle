import { $ } from "bun";
import type { Diff, SudoMode } from "@bicycle/shared";
import * as config from "../config";
import { log } from "../logger";
import { interpolate } from "../interpolate";
import { bin } from "./bin";

type User = NonNullable<config.BicycleConfig["users"]>[number];

type Existing = { name: string; uid: number; gid: number; groups: string[] };

type Action =
  | { do: "create"; user: User; groups: string[] }
  | { do: "uid-mismatch"; user: User; have: number }
  | { do: "add-groups"; user: User; want: string[]; have: string[] }
  | { do: "undeclared"; name: string; uid: number };

const passwd = async (name: string): Promise<Existing | null> => {
  const r = await $`${bin("getent")} passwd ${name}`.quiet().nothrow();
  if (r.exitCode !== 0) return null;
  const parts = r.stdout.toString().trim().split(":");
  const uid = Number(parts[2]);
  const gid = Number(parts[3]);
  if (!Number.isInteger(uid) || !Number.isInteger(gid)) return null;
  return { name: parts[0]!, uid, gid, groups: await supplementary(name) };
};

export const HUMAN_ID_MIN = 1000;
export const HUMAN_ID_MAX = 60000;

export const allPasswd = async (): Promise<{ name: string; uid: number }[]> => {
  const r = await $`${bin("getent")} passwd`.quiet().nothrow();
  if (r.exitCode !== 0) return [];
  const out: { name: string; uid: number }[] = [];
  for (const line of r.stdout.toString().split("\n")) {
    const parts = line.split(":");
    const uid = Number(parts[2]);
    if (!parts[0] || !Number.isInteger(uid)) continue;
    out.push({ name: parts[0], uid });
  }
  return out;
};

const supplementary = async (name: string): Promise<string[]> => {
  const r = await $`${bin("id")} -nG ${name}`.quiet().nothrow();
  if (r.exitCode !== 0) return [];
  return r.stdout.toString().trim().split(/\s+/).filter(Boolean);
};

const wantedGroups = (u: { sudo: SudoMode; groups: string[] }): string[] =>
  [...new Set(u.sudo !== "none" ? [...u.groups, "wheel"] : u.groups)];

const actions = async (): Promise<Action[]> => {
  const cfg = config.maybe();
  if (!cfg) return [];
  const wanted = cfg.users ?? [];
  const out: Action[] = [];
  for (const u of wanted) {
    const existing = await passwd(u.name);
    if (!existing) {
      out.push({ do: "create", user: u, groups: wantedGroups(u) });
      continue;
    }
    if (u.uid !== undefined && existing.uid !== u.uid) {
      out.push({ do: "uid-mismatch", user: u, have: existing.uid });
    }
    const want = wantedGroups(u);
    const have = new Set(existing.groups);
    if (want.some((g) => !have.has(g))) {
      out.push({ do: "add-groups", user: u, want, have: existing.groups });
    }
  }
  const declared = new Set(wanted.map((u) => u.name));
  for (const e of await allPasswd()) {
    if (e.uid < HUMAN_ID_MIN || e.uid >= HUMAN_ID_MAX || declared.has(e.name)) continue;
    out.push({ do: "undeclared", name: e.name, uid: e.uid });
  }
  return out;
};

const toDiff = (a: Action): Diff => {
  switch (a.do) {
    case "create":
      return { type: "user", id: a.user.name, field: "exists", expected: true, actual: false };
    case "uid-mismatch":
      return { type: "user", id: a.user.name, field: "uid", expected: a.user.uid!, actual: a.have };
    case "add-groups":
      return { type: "user", id: a.user.name, field: "groups", expected: a.want, actual: a.have };
    case "undeclared":
      return { type: "user", id: a.name, field: "exists", expected: null, actual: true, meta: { uid: a.uid } };
  }
};

export const plan = async (): Promise<Diff[]> => (await actions()).map(toDiff);

const createUser = async (
  name: string,
  uid: number | undefined,
  groups: string[],
): Promise<boolean> => {
  const args = ["-m"];
  if (uid !== undefined) args.push("-u", String(uid));
  if (groups.length > 0) args.push("-G", groups.join(","));
  args.push("--", name);
  log.info({ user: name, uid, groups }, "users: creating");
  const r = await $`${bin("useradd")} ${args}`.quiet().nothrow();
  if (r.exitCode !== 0) {
    log.error(
      { user: name, exitCode: r.exitCode, stderr: r.stderr.toString().trim() },
      "users: useradd failed",
    );
    return false;
  }
  return true;
};

// Resolve a user's password secret ref and apply it with chpasswd. The clear
// password is fed via stdin (never interpolated into a shell string) so it
// can't be injected or leak into the process table. Only called right after
// creating a user — we don't reset passwords on every reconcile, both to
// avoid churning /etc/shadow and to avoid clobbering a password the operator
// later changed by hand.
const setPassword = async (
  name: string,
  ref: string,
  vars: unknown,
): Promise<void> => {
  let clear: string;
  try {
    clear = await interpolate(ref, vars);
  } catch (e) {
    log.error({ user: name, err: e }, "users: failed to resolve password secret");
    return;
  }
  // Refuse to set an empty password — that would create a passwordless login.
  // Matches the installer's promoteUsers() guard. Secret content is treated
  // verbatim on both sides (no trimming).
  if (clear.length === 0) {
    log.error({ user: name }, "users: password secret is empty; not setting password");
    return;
  }
  const line = Buffer.from(`${name}:${clear}\n`);
  const r = await $`${bin("chpasswd")} < ${line}`.quiet().nothrow();
  if (r.exitCode !== 0) {
    log.error(
      { user: name, exitCode: r.exitCode, stderr: r.stderr.toString().trim() },
      "users: chpasswd failed",
    );
    return;
  }
  log.info({ user: name }, "users: password set");
};

const addToGroups = async (name: string, missing: string[]): Promise<void> => {
  if (missing.length === 0) return;
  log.info({ user: name, groups: missing }, "users: adding to groups");
  const r = await $`${bin("usermod")} -aG ${missing.join(",")} ${name}`.quiet().nothrow();
  if (r.exitCode !== 0) {
    log.error(
      { user: name, groups: missing, exitCode: r.exitCode, stderr: r.stderr.toString().trim() },
      "users: usermod failed",
    );
  }
};

export const all = async (): Promise<void> => {
  const vars = config.maybe()?.vars;
  for (const a of await actions()) {
    switch (a.do) {
      case "create": {
        const created = await createUser(a.user.name, a.user.uid, a.groups);
        // Set the password only on first creation. If creation failed, skip.
        if (created && a.user.password) await setPassword(a.user.name, a.user.password, vars);
        break;
      }
      case "uid-mismatch":
        log.warn(
          { user: a.user.name, wantUid: a.user.uid, haveUid: a.have },
          "users: uid mismatch; refusing to modify live user, run 'usermod -u <uid> <name>' manually",
        );
        break;
      case "add-groups": {
        const have = new Set(a.have);
        await addToGroups(a.user.name, a.want.filter((g) => !have.has(g)));
        break;
      }
      case "undeclared":
        break;
    }
  }
};
