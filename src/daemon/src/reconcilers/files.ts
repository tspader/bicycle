import crypto from "crypto";
import fs from "fs";
import path from "path";
import { env } from "../env";
import { paths } from "../paths";
import * as age from "../age";
import { chownIgnoreEperm } from "../fs";
import { log } from "../logger";

const walk = (root: string): string[] => {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile()) out.push(full);
    }
  }
  return out;
};

const sha = (b: Uint8Array): string =>
  crypto.createHash("sha256").update(b).digest("hex");

const destFor = (src: string, srcRoot: string, hostRoot: string): string => {
  const rel = path.relative(srcRoot, src);
  const stripped = rel.endsWith(".age") ? rel.slice(0, -".age".length) : rel;
  return path.join(hostRoot, stripped);
};

const loadPlaintext = async (src: string): Promise<Uint8Array> =>
  src.endsWith(".age") ? age.decrypt(src) : new Uint8Array(fs.readFileSync(src));

const ensureDir = (target: string): void => {
  if (fs.existsSync(target)) return;
  const parent = path.dirname(target);
  ensureDir(parent);
  const parentStat = fs.statSync(parent);
  fs.mkdirSync(target);
  chownIgnoreEperm(target, parentStat.uid, parentStat.gid);
};

const writeAtomic = (dest: string, bytes: Uint8Array): void => {
  const parent = path.dirname(dest);
  ensureDir(parent);
  const parentStat = fs.statSync(parent);
  const tmp = `${dest}.bicycle.tmp`;
  fs.writeFileSync(tmp, bytes, { mode: 0o600 });
  try {
    chownIgnoreEperm(tmp, parentStat.uid, parentStat.gid);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
  fs.renameSync(tmp, dest);
};

export const reconcile = async (): Promise<void> => {
  const srcRoot = paths.etc.files;
  const hostRoot = env.HOST_ROOT;
  if (!fs.existsSync(srcRoot)) return;

  for (const src of walk(srcRoot)) {
    try {
      const dest = destFor(src, srcRoot, hostRoot);
      const plaintext = await loadPlaintext(src);
      if (fs.existsSync(dest)) {
        const existing = new Uint8Array(fs.readFileSync(dest));
        if (sha(existing) === sha(plaintext)) continue;
      }
      writeAtomic(dest, plaintext);
      log.info({ src, dest }, "files: wrote");
    } catch (e) {
      log.error({ err: e, src }, "files: failed");
    }
  }
};
