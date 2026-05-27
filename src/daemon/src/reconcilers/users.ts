import { $ } from "bun";
import fs from "fs";
import * as config from "../config";
import { paths } from "../paths";
import { log } from "../logger";

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

const wantedGroups = (u: { sudo: boolean; groups: string[] }): string[] =>
  [...new Set(u.sudo ? [...u.groups, "wheel"] : u.groups)];

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
  const wanted = config.bicycle().users ?? [];
  for (const u of wanted) {
    const want = wantedGroups(u);
    const existing = await passwd(u.name);
    if (!existing) {
      await createUser(u.name, u.uid, want);
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
