import { test, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import * as users from "./users";

let tmp: string;
let saved: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-users-"));
  saved = process.env.BICYCLE_ETC;
  process.env.BICYCLE_ETC = tmp;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (saved === undefined) delete process.env.BICYCLE_ETC;
  else process.env.BICYCLE_ETC = saved;
});

const writeBicycleYaml = (body: string) => {
  fs.writeFileSync(path.join(tmp, "bicycle.yml"), body);
};

test("no bicycle.yml: no-op without throwing", async () => {
  await users.all();
});

test("no users block: no-op without throwing", async () => {
  writeBicycleYaml(`catalog:\n  url: "x"\n`);
  await users.all();
});

test("users empty: no-op without throwing", async () => {
  writeBicycleYaml(`catalog:\n  url: "x"\nusers: []\n`);
  await users.all();
});

test("existing root user with no extra groups: no-op", async () => {
  // root always exists; declaring it with empty groups and no sudo
  // should not try to modify anything.
  writeBicycleYaml(`catalog:\n  url: "x"\nusers:\n  - { name: root, sudo: none, groups: [] }\n`);
  await users.all();
});
