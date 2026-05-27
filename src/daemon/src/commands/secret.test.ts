import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { generateIdentity, identityToRecipient } from "age-encryption";
import * as secret from "./secret";

let tmp: string;
let etc: string;
let saved: Record<string, string | undefined> = {};

const set = (k: string, v: string) => {
  saved[k] = process.env[k];
  process.env[k] = v;
};

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-secret-cmd-"));
  etc = path.join(tmp, "etc");
  fs.mkdirSync(path.join(etc, "secrets"), { recursive: true });

  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  const keyPath = path.join(tmp, "age.key");
  fs.writeFileSync(keyPath, identity);
  fs.writeFileSync(path.join(etc, "recipients"), recipient + "\n");

  set("BICYCLE_ETC", etc);
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

const bytes = (s: string) => new TextEncoder().encode(s);

test("writeSecret + readSecret round-trip", async () => {
  await secret.writeSecret("foo", bytes("hunter2"));
  expect(await secret.readSecret("foo")).toBe("hunter2");
});

test("writeSecret creates nested address directories", async () => {
  const dest = await secret.writeSecret("miniflux/db-password", bytes("pw"));
  expect(dest).toBe(path.join(etc, "secrets", "miniflux", "db-password.age"));
  expect(fs.existsSync(dest)).toBe(true);
  expect(await secret.readSecret("miniflux/db-password")).toBe("pw");
});

test("writeSecret writes 0600 perms", async () => {
  const dest = await secret.writeSecret("perm", bytes("x"));
  expect(fs.statSync(dest).mode & 0o777).toBe(0o600);
});

test("writeSecret rejects empty plaintext", async () => {
  await expect(secret.writeSecret("e", new Uint8Array())).rejects.toThrow(/empty/);
});

test("writeSecret throws when recipients file missing", async () => {
  fs.unlinkSync(path.join(etc, "recipients"));
  await expect(secret.writeSecret("x", bytes("v"))).rejects.toThrow(/recipients file missing/);
});

test("writeSecret throws when recipients file empty", async () => {
  fs.writeFileSync(path.join(etc, "recipients"), "# only a comment\n\n");
  await expect(secret.writeSecret("x", bytes("v"))).rejects.toThrow(/no recipients/);
});

test("writeSecret rejects path traversal", async () => {
  await expect(secret.writeSecret("../escape", bytes("v"))).rejects.toThrow(/escapes/);
});

test("listSecrets returns empty array when secrets dir absent", () => {
  fs.rmSync(path.join(etc, "secrets"), { recursive: true });
  expect(secret.listSecrets()).toEqual([]);
});

test("listSecrets lists nested addresses sorted, strips .age", async () => {
  await secret.writeSecret("b", bytes("1"));
  await secret.writeSecret("a/two", bytes("2"));
  await secret.writeSecret("a/one", bytes("3"));
  expect(secret.listSecrets()).toEqual(["a/one", "a/two", "b"]);
});

test("removeSecret deletes file", async () => {
  await secret.writeSecret("gone", bytes("x"));
  secret.removeSecret("gone");
  expect(secret.listSecrets()).toEqual([]);
});

test("removeSecret throws when secret absent", () => {
  expect(() => secret.removeSecret("ghost")).toThrow(/no such secret/);
});

test("readSecret throws on missing secret", async () => {
  await expect(secret.readSecret("ghost")).rejects.toThrow();
});
