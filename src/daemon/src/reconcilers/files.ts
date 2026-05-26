import crypto from "crypto";
import fs from "fs";
import path from "path";
import { env } from "../env";
import { paths } from "../paths";
import * as age from "../age";

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

const writeAtomic = (dest: string, bytes: Uint8Array): void => {
  const parent = path.dirname(dest);
  fs.mkdirSync(parent, { recursive: true });
  const parentStat = fs.statSync(parent);
  const tmp = `${dest}.bicycle.tmp`;
  fs.writeFileSync(tmp, bytes, { mode: 0o600 });
  try {
    fs.chownSync(tmp, parentStat.uid, parentStat.gid);
  } catch (e: any) {
    // Non-root processes can't chown; fine for dev/test, the daemon runs as root.
    if (e.code !== "EPERM") {
      try { fs.unlinkSync(tmp); } catch {}
      throw e;
    }
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
      console.log(`files: wrote ${dest}`);
    } catch (e: any) {
      console.error(`files: failed ${src}: ${e.message ?? e}`);
    }
  }
};
