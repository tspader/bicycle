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

test("mirrors plaintext file into host root with the source's mode", async () => {
  stage("etc/foo.conf", "hello");
  fs.chmodSync(path.join(etc, "files", "etc/foo.conf"), 0o644);
  await files.all();
  const dest = path.join(host, "etc/foo.conf");
  expect(fs.readFileSync(dest, "utf8")).toBe("hello");
  expect(fs.statSync(dest).mode & 0o777).toBe(0o644);
});

test("preserves the executable bit from the source", async () => {
  stage("usr/local/bin/hook", "#!/bin/sh\necho hi\n");
  fs.chmodSync(path.join(etc, "files", "usr/local/bin/hook"), 0o755);
  await files.all();
  expect(fs.statSync(path.join(host, "usr/local/bin/hook")).mode & 0o777).toBe(0o755);
});

test("decrypts .age files, strips suffix, and forces 0600", async () => {
  await stageAge("etc/secret.conf.age", "decrypted");
  // The .age source is 0644 (as git stores it) — the secret must still land 0600.
  fs.chmodSync(path.join(etc, "files", "etc/secret.conf.age"), 0o644);
  await files.all();
  const dest = path.join(host, "etc/secret.conf");
  expect(fs.existsSync(`${dest}.age`)).toBe(false);
  expect(fs.readFileSync(dest, "utf8")).toBe("decrypted");
  expect(fs.statSync(dest).mode & 0o777).toBe(0o600);
});

test("fixes a stale mode even when content is unchanged", async () => {
  stage("etc/foo.conf", "hello");
  fs.chmodSync(path.join(etc, "files", "etc/foo.conf"), 0o644);
  await files.all();
  const dest = path.join(host, "etc/foo.conf");
  // Simulate a file written under the old hardcoded-0600 behaviour.
  fs.chmodSync(dest, 0o600);
  await files.all();
  expect(fs.statSync(dest).mode & 0o777).toBe(0o644);
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
