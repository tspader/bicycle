import { test, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import * as packages from "./packages";

let tmp: string;
let saved: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-packages-"));
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

test("no packages block: no-op without throwing", async () => {
  writeBicycleYaml(`catalog:\n  url: "x"\n`);
  await packages.all();
});

test("packages.extra empty: no-op without throwing", async () => {
  writeBicycleYaml(`catalog:\n  url: "x"\npackages:\n  extra: []\n`);
  await packages.all();
});
