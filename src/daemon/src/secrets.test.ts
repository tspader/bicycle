import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { generateIdentity, identityToRecipient } from "age-encryption";
import * as age from "./age";
import * as secrets from "./secrets";

let tmp: string;
let recipient: string;
let savedEtc: string | undefined;
let savedAgeKey: string | undefined;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-secrets-"));
  const identity = await generateIdentity();
  recipient = await identityToRecipient(identity);
  const keyPath = path.join(tmp, "age.key");
  fs.writeFileSync(keyPath, identity);
  fs.mkdirSync(path.join(tmp, "secrets"), { recursive: true });
  savedEtc = process.env.BICYCLE_ETC;
  savedAgeKey = process.env.AGE_KEY;
  process.env.BICYCLE_ETC = tmp;
  process.env.AGE_KEY = keyPath;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (savedEtc === undefined) delete process.env.BICYCLE_ETC;
  else process.env.BICYCLE_ETC = savedEtc;
  if (savedAgeKey === undefined) delete process.env.AGE_KEY;
  else process.env.AGE_KEY = savedAgeKey;
});

const writeSecret = async (addr: string, value: string) => {
  const dest = path.join(tmp, "secrets", `${addr}.age`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ciphertext = await age.encrypt(new TextEncoder().encode(value), [recipient]);
  fs.writeFileSync(dest, ciphertext);
};

test("interpolate substitutes a single token", async () => {
  await writeSecret("db/password", "hunter2");
  expect(await secrets.interpolate("PASS=${secret:db/password}")).toBe("PASS=hunter2");
});

test("interpolate substitutes multiple tokens in one string", async () => {
  await writeSecret("a", "one");
  await writeSecret("b", "two");
  expect(await secrets.interpolate("X=${secret:a};Y=${secret:b};Z=${secret:a}")).toBe(
    "X=one;Y=two;Z=one",
  );
});

test("interpolate returns input unchanged when no tokens", async () => {
  expect(await secrets.interpolate("plain string")).toBe("plain string");
});

test("missing secret throws", async () => {
  await expect(secrets.interpolate("X=${secret:nope}")).rejects.toThrow();
});

test("rejects path traversal", async () => {
  await expect(secrets.interpolate("X=${secret:../etc/passwd}")).rejects.toThrow(/escapes/);
});

test("rejects absolute address", async () => {
  await expect(secrets.interpolate("X=${secret:/abs}")).rejects.toThrow(/relative/);
});

test("resolve returns plaintext directly", async () => {
  await writeSecret("api/token", "abc123");
  expect(await secrets.resolve("api/token")).toBe("abc123");
});
