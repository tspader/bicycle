import { $ } from "bun";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Diff, SudoMode } from "@bicycle/shared";
import * as config from "../config";
import { env } from "../env";
import { paths } from "../paths";
import { log } from "../logger";

type SudoUser = { name: string; sudo: SudoMode };

// One sudoers spec line per user, or null for non-sudoers. Pure so it can be
// unit-tested without touching the filesystem or invoking visudo.
export const ruleFor = (u: SudoUser): string | null => {
  if (u.sudo === "passwordless") return `${u.name} ALL=(ALL:ALL) NOPASSWD: ALL`;
  if (u.sudo === "password") return `${u.name} ALL=(ALL:ALL) ALL`;
  return null;
};

export const rulesFor = (users: SudoUser[]): string[] =>
  users.map(ruleFor).filter((l): l is string => l !== null);

const TARGET = "etc/sudoers.d/bicycle";

const dropInPath = (): string => path.join(env.HOST_ROOT, TARGET);

const render = (lines: string[]): string =>
  `# Managed by Bicycle. Do not edit.\n${lines.join("\n")}\n`;

const sha = (s: string): string =>
  crypto.createHash("sha256").update(s).digest("hex");

export const plan = async (): Promise<Diff[]> => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return [];
  const dest = dropInPath();
  const lines = rulesFor(config.bicycle().users ?? []);
  const current = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;
  if (lines.length === 0) {
    if (current === null) return [];
    return [{ type: "file", id: TARGET, field: "exists", expected: false, actual: true }];
  }
  const want = render(lines);
  if (current === want) return [];
  return [{
    type: "file",
    id: TARGET,
    field: "content",
    expected: sha(want),
    actual: current === null ? null : sha(current),
  }];
};

export const all = async (): Promise<void> => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return;
  if ((await plan()).length === 0) return;
  const dest = dropInPath();
  const lines = rulesFor(config.bicycle().users ?? []);

  // No sudo users: ensure our drop-in is gone rather than leaving a stale grant.
  if (lines.length === 0) {
    fs.rmSync(dest);
    log.info({ dest }, "sudoers: removed (no sudo users)");
    return;
  }

  const content = render(lines);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // Temp name carries a dot so sudo's #includedir skips it while present; only
  // the final `bicycle` (no dot) is ever loaded.
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o440 });

  // A malformed sudoers file can lock out sudo entirely, so validate before
  // activating and never rename in an unchecked file.
  const check = await $`visudo -cf ${tmp}`.quiet().nothrow();
  if (check.exitCode !== 0) {
    log.error(
      { exitCode: check.exitCode, stderr: check.stderr.toString().trim() },
      "sudoers: visudo validation failed; not applying",
    );
    try { fs.rmSync(tmp); } catch {}
    return;
  }

  fs.chmodSync(tmp, 0o440);
  fs.renameSync(tmp, dest);
  log.info({ dest, users: lines.length }, "sudoers: wrote");
};
