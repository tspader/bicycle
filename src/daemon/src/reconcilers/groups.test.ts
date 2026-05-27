import { test, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import * as groups from "./groups";

let tmp: string;
let saved: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-groups-"));
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
  await groups.all();
});

test("no groups block: no-op without throwing", async () => {
  writeBicycleYaml(`catalog:\n  url: "x"\n`);
  await groups.all();
});

test("groups empty: no-op without throwing", async () => {
  writeBicycleYaml(`catalog:\n  url: "x"\ngroups: []\n`);
  await groups.all();
});

test("existing group with matching gid: no-op", async () => {
  // root group always exists at gid 0
  writeBicycleYaml(`catalog:\n  url: "x"\ngroups:\n  - { name: root, gid: 0 }\n`);
  await groups.all();
});
