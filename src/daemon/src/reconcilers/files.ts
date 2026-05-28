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

// Destination permission bits. Secrets are always 0600 — the .age source is
// itself stored 0644 (git tracks only the exec bit), so inheriting its mode
// would leave the decrypted plaintext world-readable. Everything else mirrors
// the source file's mode, so the tree controls perms: 0644 for normal configs
// (e.g. .bashrc, /etc/* read by other users/services), 0755 for scripts.
const modeFor = (src: string): number =>
  src.endsWith(".age") ? 0o600 : fs.statSync(src).mode & 0o777;

const writeAtomic = (dest: string, bytes: Uint8Array, mode: number): void => {
  const parent = path.dirname(dest);
  ensureDir(parent);
  const parentStat = fs.statSync(parent);
  const tmp = `${dest}.bicycle.tmp`;
  fs.writeFileSync(tmp, bytes, { mode });
  try {
    fs.chmodSync(tmp, mode); // exact bits, regardless of umask
    chownIgnoreEperm(tmp, parentStat.uid, parentStat.gid);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
  fs.renameSync(tmp, dest);
};

export const one = async (src: string): Promise<void> => {
  const srcRoot = paths.etc.files;
  const hostRoot = env.HOST_ROOT;
  try {
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return;
    const dest = destFor(src, srcRoot, hostRoot);
    const plaintext = await loadPlaintext(src);
    const mode = modeFor(src);
    if (fs.existsSync(dest)) {
      const existing = new Uint8Array(fs.readFileSync(dest));
      if (sha(existing) === sha(plaintext)) {
        // Content already matches; still reconcile the mode so files written
        // under the old hardcoded-0600 behaviour (or chmod'd out of band) get
        // corrected without needing a content change.
        if ((fs.statSync(dest).mode & 0o777) !== mode) {
          fs.chmodSync(dest, mode);
          log.info({ dest, mode: mode.toString(8) }, "files: fixed mode");
        }
        return;
      }
    }
    writeAtomic(dest, plaintext, mode);
    log.info({ src, dest }, "files: wrote");
  } catch (e) {
    log.error({ err: e, src }, "files: failed");
  }
};

export const all = async (): Promise<void> => {
  const srcRoot = paths.etc.files;
  if (!fs.existsSync(srcRoot)) return;
  for (const src of walk(srcRoot)) {
    await one(src);
  }
};
