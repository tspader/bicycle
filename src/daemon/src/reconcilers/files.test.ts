import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { generateIdentity, identityToRecipient } from "age-encryption";
import * as age from "../age";
import * as files from "./files";

let tmp: string;
let etc: string;
let host: string;
let recipient: string;
let saved: Record<string, string | undefined> = {};

const set = (k: string, v: string) => {
  saved[k] = process.env[k];
  process.env[k] = v;
};

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-files-"));
  etc = path.join(tmp, "etc");
  host = path.join(tmp, "host");
  fs.mkdirSync(path.join(etc, "files"), { recursive: true });
  fs.mkdirSync(host, { recursive: true });

  const identity = await generateIdentity();
  recipient = await identityToRecipient(identity);
  const keyPath = path.join(tmp, "age.key");
  fs.writeFileSync(keyPath, identity);

  set("BICYCLE_ETC", etc);
  set("BICYCLE_HOST_ROOT", host);
  set("AGE_KEY", keyPath);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved = {};
});

const stage = (rel: string, contents: string | Uint8Array) => {
  const p = path.join(etc, "files", rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contents);
};

const stageAge = async (rel: string, plaintext: string) => {
  const ciphertext = await age.encrypt(new TextEncoder().encode(plaintext), [recipient]);
  stage(rel, ciphertext);
};

test("mirrors plaintext file into host root with 0600", async () => {
  stage("etc/foo.conf", "hello");
  await files.all();
  const dest = path.join(host, "etc/foo.conf");
  expect(fs.readFileSync(dest, "utf8")).toBe("hello");
  expect(fs.statSync(dest).mode & 0o777).toBe(0o600);
});

test("decrypts .age files and strips suffix from destination", async () => {
  await stageAge("etc/secret.conf.age", "decrypted");
  await files.all();
  const dest = path.join(host, "etc/secret.conf");
  expect(fs.existsSync(`${dest}.age`)).toBe(false);
  expect(fs.readFileSync(dest, "utf8")).toBe("decrypted");
  expect(fs.statSync(dest).mode & 0o777).toBe(0o600);
});

test("creates nested parent directories", async () => {
  stage("a/b/c/d.txt", "deep");
  await files.all();
  expect(fs.readFileSync(path.join(host, "a/b/c/d.txt"), "utf8")).toBe("deep");
});

test("idempotent: second pass does not rewrite unchanged files", async () => {
  stage("foo", "same");
  await files.all();
  const dest = path.join(host, "foo");
  const before = fs.statSync(dest);
  // Backdate so a rewrite would be detectable as mtime increase.
  const old = new Date(before.mtimeMs - 60_000);
  fs.utimesSync(dest, old, old);
  const stamp = fs.statSync(dest).mtimeMs;
  await files.all();
  expect(fs.statSync(dest).mtimeMs).toBe(stamp);
});

test("rewrites when source content changes", async () => {
  stage("foo", "v1");
  await files.all();
  const dest = path.join(host, "foo");
  expect(fs.readFileSync(dest, "utf8")).toBe("v1");
  stage("foo", "v2");
  await files.all();
  expect(fs.readFileSync(dest, "utf8")).toBe("v2");
});

test("continues past a bad .age file", async () => {
  stage("etc/bad.age", "not-actually-age-encrypted");
  stage("etc/good", "ok");
  await files.all();
  expect(fs.existsSync(path.join(host, "etc/bad"))).toBe(false);
  expect(fs.readFileSync(path.join(host, "etc/good"), "utf8")).toBe("ok");
});

test("no-op when source root does not exist", async () => {
  fs.rmSync(path.join(etc, "files"), { recursive: true });
  await files.all();
});
