import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import * as sudoers from "./sudoers";

let tmp: string;
let etc: string;
let host: string;
let dropIn: string;
let saved: Record<string, string | undefined> = {};

const set = (k: string, v: string) => {
  saved[k] = process.env[k];
  process.env[k] = v;
};

const hasVisudo = Bun.which("visudo") !== null;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-sudoers-"));
  etc = path.join(tmp, "etc");
  host = path.join(tmp, "host");
  fs.mkdirSync(etc, { recursive: true });
  fs.mkdirSync(host, { recursive: true });
  dropIn = path.join(host, "etc", "sudoers.d", "bicycle");
  set("BICYCLE_ETC", etc);
  set("BICYCLE_HOST_ROOT", host);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved = {};
});

const writeYaml = (body: string) =>
  fs.writeFileSync(path.join(etc, "bicycle.yml"), body);

test("ruleFor maps each sudo mode", () => {
  expect(sudoers.ruleFor({ name: "a", sudo: "none" })).toBeNull();
  expect(sudoers.ruleFor({ name: "a", sudo: "password" })).toBe("a ALL=(ALL:ALL) ALL");
  expect(sudoers.ruleFor({ name: "a", sudo: "passwordless" })).toBe("a ALL=(ALL:ALL) NOPASSWD: ALL");
});

test("rulesFor keeps only sudoers, preserving order", () => {
  expect(sudoers.rulesFor([
    { name: "a", sudo: "password" },
    { name: "b", sudo: "none" },
    { name: "c", sudo: "passwordless" },
  ])).toEqual([
    "a ALL=(ALL:ALL) ALL",
    "c ALL=(ALL:ALL) NOPASSWD: ALL",
  ]);
});

test("no bicycle.yml: no-op", async () => {
  await sudoers.all();
  expect(fs.existsSync(dropIn)).toBe(false);
});

test("no sudo users: removes a stale drop-in", async () => {
  fs.mkdirSync(path.dirname(dropIn), { recursive: true });
  fs.writeFileSync(dropIn, "stale\n");
  writeYaml(`catalog:\n  url: "x"\nusers:\n  - { name: bob, sudo: none, groups: [] }\n`);
  await sudoers.all();
  expect(fs.existsSync(dropIn)).toBe(false);
});

test.skipIf(!hasVisudo)("writes a validated drop-in for sudo users", async () => {
  writeYaml(
    `catalog:\n  url: "x"\nusers:\n` +
    `  - { name: alice, sudo: password, groups: [wheel] }\n` +
    `  - { name: deploy, sudo: passwordless, groups: [] }\n` +
    `  - { name: bob, sudo: none, groups: [] }\n`,
  );
  await sudoers.all();
  const out = fs.readFileSync(dropIn, "utf8");
  expect(out).toContain("alice ALL=(ALL:ALL) ALL");
  expect(out).toContain("deploy ALL=(ALL:ALL) NOPASSWD: ALL");
  expect(out).not.toContain("bob");
  expect(fs.statSync(dropIn).mode & 0o777).toBe(0o440);
});

test.skipIf(!hasVisudo)("idempotent: unchanged config does not rewrite", async () => {
  writeYaml(`catalog:\n  url: "x"\nusers:\n  - { name: alice, sudo: password, groups: [] }\n`);
  await sudoers.all();
  const before = fs.statSync(dropIn).mtimeMs;
  const old = new Date(before - 60_000);
  fs.utimesSync(dropIn, old, old);
  const stamp = fs.statSync(dropIn).mtimeMs;
  await sudoers.all();
  expect(fs.statSync(dropIn).mtimeMs).toBe(stamp);
});
