import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { generateIdentity, identityToRecipient } from "age-encryption";
import * as age from "./age";
import { interpolate } from "./interpolate";

let tmp: string;
let recipient: string;
let savedEtc: string | undefined;
let savedAgeKey: string | undefined;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-interpolate-"));
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

test("returns input unchanged when no tokens", async () => {
  expect(await interpolate("plain string", {})).toBe("plain string");
});

test("substitutes a single ${secret:...}", async () => {
  await writeSecret("db/password", "hunter2");
  expect(await interpolate("PASS=${secret:db/password}", {})).toBe("PASS=hunter2");
});

test("substitutes multiple ${secret:...} tokens", async () => {
  await writeSecret("a", "one");
  await writeSecret("b", "two");
  expect(await interpolate("X=${secret:a};Y=${secret:b};Z=${secret:a}", {})).toBe(
    "X=one;Y=two;Z=one",
  );
});

test("missing secret throws", async () => {
  await expect(interpolate("X=${secret:nope}", {})).rejects.toThrow();
});

test("substitutes a bare var", async () => {
  expect(await interpolate("UID=${uid}", { uid: 1000 })).toBe("UID=1000");
});

test("substitutes nested dotted var", async () => {
  expect(await interpolate("UID=${admin.uid}", { admin: { uid: 1000 } })).toBe("UID=1000");
});

test("unknown var throws", async () => {
  await expect(interpolate("X=${nope}", {})).rejects.toThrow(/unresolved/);
});

test("object value throws", async () => {
  await expect(interpolate("X=${admin}", { admin: { uid: 1 } })).rejects.toThrow(/object/);
});

test("mixes secret and var in one string", async () => {
  await writeSecret("api/key", "k123");
  expect(
    await interpolate(
      "https://${host}.lan/api?k=${secret:api/key}",
      { host: "miniflux" },
    ),
  ).toBe("https://miniflux.lan/api?k=k123");
});
