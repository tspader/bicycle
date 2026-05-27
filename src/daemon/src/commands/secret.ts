import type { Command } from "@spader/zargs";
import fs from "fs";
import path from "path";
import { paths } from "../paths";
import * as age from "../age";
import { log } from "../logger";

const loadRecipients = (): string[] => {
  const file = paths.etc.recipients;
  if (!fs.existsSync(file)) {
    throw new Error(`recipients file missing: ${file}`);
  }
  const out: string[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    out.push(t);
  }
  if (out.length === 0) throw new Error(`no recipients in ${file}`);
  return out;
};

export const writeSecret = async (
  addr: string,
  plaintext: Uint8Array,
): Promise<string> => {
  if (plaintext.length === 0) throw new Error("refusing to write empty secret");
  const dest = paths.etc.secret(addr);
  const recipients = loadRecipients();
  const ct = await age.encrypt(plaintext, recipients);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, ct, { mode: 0o600 });
  return dest;
};

export const readSecret = async (addr: string): Promise<string> =>
  age.decryptText(paths.etc.secret(addr));

export const listSecrets = (): string[] => {
  const root = paths.etc.secrets;
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith(".age")) {
        out.push(path.relative(root, full).slice(0, -".age".length));
      }
    }
  };
  walk(root);
  out.sort();
  return out;
};

export const removeSecret = (addr: string): void => {
  const p = paths.etc.secret(addr);
  if (!fs.existsSync(p)) throw new Error(`no such secret: ${addr}`);
  fs.unlinkSync(p);
};

const readStdin = async (): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  if (out.length > 0 && out[out.length - 1] === 0x0a) {
    return out.subarray(0, out.length - 1);
  }
  return out;
};

const setCmd: Command = {
  description: "Encrypt stdin and write to <etc>/secrets/<addr>.age",
  summary: "Create or replace a secret",
  positionals: {
    addr: { type: "string", description: "secret address (e.g. miniflux/db-password)", required: true },
  },
  handler: async (argv) => {
    const addr = String(argv.addr);
    if (process.stdin.isTTY) {
      process.stderr.write(`reading secret from stdin; type the value and press Ctrl+D:\n`);
    }
    const plaintext = await readStdin();
    const dest = await writeSecret(addr, plaintext);
    log.info({ addr, dest }, "secret: wrote");
  },
};

const getCmd: Command = {
  description: "Decrypt a secret and print its plaintext to stdout",
  summary: "Read a secret",
  positionals: {
    addr: { type: "string", description: "secret address", required: true },
  },
  handler: async (argv) => {
    const text = await readSecret(String(argv.addr));
    process.stdout.write(text);
    if (process.stdout.isTTY && !text.endsWith("\n")) process.stdout.write("\n");
  },
};

const lsCmd: Command = {
  description: "List secret addresses under <etc>/secrets",
  summary: "List secrets",
  handler: () => {
    for (const a of listSecrets()) process.stdout.write(a + "\n");
  },
};

const rmCmd: Command = {
  description: "Delete a secret",
  summary: "Remove a secret",
  positionals: {
    addr: { type: "string", description: "secret address", required: true },
  },
  handler: (argv) => {
    removeSecret(String(argv.addr));
    log.info({ addr: argv.addr }, "secret: removed");
  },
};

export const command: Command = {
  description: "Manage encrypted secrets in <etc>/secrets",
  summary: "Create / read / list / delete age-encrypted secrets",
  commands: { set: setCmd, get: getCmd, ls: lsCmd, rm: rmCmd },
};
