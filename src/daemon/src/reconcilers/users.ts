import { $ } from "bun";
import fs from "fs";
import type { SudoMode } from "@bicycle/shared";
import * as config from "../config";
import { paths } from "../paths";
import { log } from "../logger";
import { interpolate } from "../interpolate";

type Existing = { name: string; uid: number; gid: number; groups: string[] };

const passwd = async (name: string): Promise<Existing | null> => {
  const r = await $`getent passwd ${name}`.quiet().nothrow();
  if (r.exitCode !== 0) return null;
  const parts = r.stdout.toString().trim().split(":");
  const uid = Number(parts[2]);
  const gid = Number(parts[3]);
  if (!Number.isInteger(uid) || !Number.isInteger(gid)) return null;
  return { name: parts[0]!, uid, gid, groups: await supplementary(name) };
};

const supplementary = async (name: string): Promise<string[]> => {
  const r = await $`id -nG ${name}`.quiet().nothrow();
  if (r.exitCode !== 0) return [];
  return r.stdout.toString().trim().split(/\s+/).filter(Boolean);
};

const wantedGroups = (u: { sudo: SudoMode; groups: string[] }): string[] =>
  [...new Set(u.sudo !== "none" ? [...u.groups, "wheel"] : u.groups)];

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
  const r = await $`useradd ${args}`.quiet().nothrow();
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
  const r = await $`chpasswd < ${line}`.quiet().nothrow();
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
  const r = await $`usermod -aG ${missing.join(",")} ${name}`.quiet().nothrow();
  if (r.exitCode !== 0) {
    log.error(
      { user: name, groups: missing, exitCode: r.exitCode, stderr: r.stderr.toString().trim() },
      "users: usermod failed",
    );
  }
};

export const all = async (): Promise<void> => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return;
  const cfg = config.bicycle();
  const wanted = cfg.users ?? [];
  for (const u of wanted) {
    const want = wantedGroups(u);
    const existing = await passwd(u.name);
    if (!existing) {
      const created = await createUser(u.name, u.uid, want);
      // Set the password only on first creation. If creation failed, skip.
      if (created && u.password) await setPassword(u.name, u.password, cfg.vars);
      continue;
    }
    if (u.uid !== undefined && existing.uid !== u.uid) {
      log.warn(
        { user: u.name, wantUid: u.uid, haveUid: existing.uid },
        "users: uid mismatch; refusing to modify live user, run 'usermod -u <uid> <name>' manually",
      );
    }
    const have = new Set(existing.groups);
    const missing = want.filter((g) => !have.has(g));
    await addToGroups(u.name, missing);
  }
};
