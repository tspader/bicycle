import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { generateIdentity, identityToRecipient } from "age-encryption";
import * as age from "./age";

let tmp: string;
let savedAgeKey: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-age-"));
  savedAgeKey = process.env.AGE_KEY;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (savedAgeKey === undefined) delete process.env.AGE_KEY;
  else process.env.AGE_KEY = savedAgeKey;
});

test("round-trip encrypt/decrypt with bytes", async () => {
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  const keyPath = path.join(tmp, "id.key");
  fs.writeFileSync(keyPath, identity);
  process.env.AGE_KEY = keyPath;

  const plaintext = new TextEncoder().encode("the quick brown fox");
  const ciphertext = await age.encrypt(plaintext, [recipient]);
  const out = await age.decrypt(write(tmp, "msg.age", ciphertext));
  expect(new TextDecoder().decode(out)).toBe("the quick brown fox");
});

test("decryptText returns string", async () => {
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  const keyPath = path.join(tmp, "id.key");
  fs.writeFileSync(keyPath, identity);
  process.env.AGE_KEY = keyPath;

  const ciphertext = await age.encrypt(new TextEncoder().encode("hello"), [recipient]);
  const p = write(tmp, "msg.age", ciphertext);
  expect(await age.decryptText(p)).toBe("hello");
});

test("decrypt with wrong key throws", async () => {
  const a = await generateIdentity();
  const recipientA = await identityToRecipient(a);
  const b = await generateIdentity();
  const keyPath = path.join(tmp, "wrong.key");
  fs.writeFileSync(keyPath, b);
  process.env.AGE_KEY = keyPath;

  const ciphertext = await age.encrypt(new TextEncoder().encode("secret"), [recipientA]);
  const p = write(tmp, "msg.age", ciphertext);
  await expect(age.decrypt(p)).rejects.toThrow();
});

test("ignores blank lines and comments in key file", async () => {
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  const keyPath = path.join(tmp, "id.key");
  fs.writeFileSync(keyPath, `# created by test\n\n${identity}\n`);
  process.env.AGE_KEY = keyPath;

  const ciphertext = await age.encrypt(new TextEncoder().encode("ok"), [recipient]);
  const p = write(tmp, "msg.age", ciphertext);
  expect(await age.decryptText(p)).toBe("ok");
});

test("empty key file throws", async () => {
  const keyPath = path.join(tmp, "empty.key");
  fs.writeFileSync(keyPath, "# nothing here\n");
  process.env.AGE_KEY = keyPath;
  const p = write(tmp, "msg.age", new Uint8Array([0]));
  await expect(age.decrypt(p)).rejects.toThrow(/no identities/);
});

const write = (dir: string, name: string, bytes: Uint8Array): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, bytes);
  return p;
};
