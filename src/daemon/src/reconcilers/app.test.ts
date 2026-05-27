import { test, expect, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";
import fs from "fs";
import os from "os";
import path from "path";
import { generateIdentity, identityToRecipient } from "age-encryption";
import * as age from "../age";
import * as app from "./app";

let tmp: string;
let etc: string;
let state: string;
let recipient: string;
let saved: Record<string, string | undefined> = {};

const set = (k: string, v: string) => {
  saved[k] = process.env[k];
  process.env[k] = v;
};

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-app-"));
  etc = path.join(tmp, "etc");
  state = path.join(tmp, "var");
  fs.mkdirSync(path.join(etc, "secrets"), { recursive: true });
  fs.mkdirSync(path.join(etc, "apps"), { recursive: true });
  fs.mkdirSync(state, { recursive: true });

  const identity = await generateIdentity();
  recipient = await identityToRecipient(identity);
  const keyPath = path.join(tmp, "age.key");
  fs.writeFileSync(keyPath, identity);

  set("BICYCLE_ETC", etc);
  set("BICYCLE_VAR", state);
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

const writeSecret = async (addr: string, value: string) => {
  const dest = path.join(etc, "secrets", `${addr}.age`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ct = await age.encrypt(new TextEncoder().encode(value), [recipient]);
  fs.writeFileSync(dest, ct);
};

const writeAppConfig = (name: string, body: string) => {
  const dir = path.join(etc, "apps", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.yml"), body);
};

const makeCatalogRepo = async (name: string, composeContent: string): Promise<{ url: string; sha: string }> => {
  const repo = path.join(tmp, "catalog");
  fs.mkdirSync(path.join(repo, name), { recursive: true });
  fs.writeFileSync(path.join(repo, name, "compose.yml"), composeContent);
  await $`git -C ${repo} init -q -b main`.quiet();
  await $`git -C ${repo} -c user.email=t@t -c user.name=t add .`.quiet();
  await $`git -C ${repo} -c user.email=t@t -c user.name=t commit -qm initial`.quiet();
  await $`git -C ${repo} config uploadpack.allowAnySHA1InWant true`.quiet();
  const sha = (await $`git -C ${repo} rev-parse HEAD`.quiet().text()).trim();
  return { url: repo, sha };
};

test("resolveAppEnv: undefined input returns empty", async () => {
  expect(await app.resolveAppEnv(undefined)).toEqual({});
});

test("resolveAppEnv: passes through literals", async () => {
  expect(await app.resolveAppEnv({ A: "1", B: "two" })).toEqual({ A: "1", B: "two" });
});

test("resolveAppEnv: interpolates ${secret:...} tokens", async () => {
  await writeSecret("foo/bar", "sekret");
  expect(await app.resolveAppEnv({ X: "v=${secret:foo/bar}" })).toEqual({ X: "v=sekret" });
});

test("resolveAppEnv: missing secret propagates as error", async () => {
  await expect(app.resolveAppEnv({ X: "${secret:nope}" })).rejects.toThrow();
});

test("buildComposeArgs: base only when no override", () => {
  expect(app.buildComposeArgs("/s/compose.yml", null)).toEqual(["-f", "/s/compose.yml"]);
});

test("buildComposeArgs: appends user override", () => {
  expect(app.buildComposeArgs("/s/compose.yml", "/e/compose.yml")).toEqual([
    "-f", "/s/compose.yml", "-f", "/e/compose.yml",
  ]);
});

test("plan: returns null when app config missing", async () => {
  fs.mkdirSync(path.join(etc, "apps", "ghost"), { recursive: true });
  expect(await app.plan("ghost", "file:///does/not/matter")).toBeNull();
});

test("plan: throws when catalog lacks <name>/compose.yml at ref", async () => {
  const { url, sha } = await makeCatalogRepo("other", "services: {}\n");
  writeAppConfig("myapp", `ref: ${sha}\n`);
  await expect(app.plan("myapp", url)).rejects.toThrow(/catalog has no myapp\/compose\.yml/);
});

test("plan: happy path builds expected plan with resolved env", async () => {
  const { url, sha } = await makeCatalogRepo("myapp", "services:\n  myapp:\n    image: x\n");
  await writeSecret("myapp/pass", "hunter2");
  writeAppConfig("myapp", `ref: ${sha}\nenv:\n  PASS: \${secret:myapp/pass}\n  PLAIN: literal\n`);

  const p = await app.plan("myapp", url);
  expect(p).not.toBeNull();
  expect(p!.name).toBe("myapp");
  expect(p!.ref).toBe(sha);
  expect(p!.env).toEqual({ PASS: "hunter2", PLAIN: "literal" });
  expect(p!.userOverride).toBeNull();
  expect(p!.baseCompose.endsWith("myapp/compose.yml")).toBe(true);
  expect(p!.stateCompose).toBe(path.join(state, "apps", "myapp", "compose.yml"));
  expect(p!.dataDir).toBe(path.join(state, "apps", "myapp", "data"));
  expect(p!.projectDir).toBe(path.join(etc, "apps", "myapp"));
});

test("plan: detects user override file", async () => {
  const { url, sha } = await makeCatalogRepo("myapp", "services:\n  myapp:\n    image: x\n");
  writeAppConfig("myapp", `ref: ${sha}\n`);
  const overridePath = path.join(etc, "apps", "myapp", "compose.yml");
  fs.writeFileSync(overridePath, "services:\n  myapp:\n    environment: {}\n");

  const p = await app.plan("myapp", url);
  expect(p!.userOverride).toBe(overridePath);
});
