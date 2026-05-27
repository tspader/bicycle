import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import * as systemd from "./systemd";

let tmp: string;
let saved: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-systemd-"));
  saved = process.env.BICYCLE_ETC;
  process.env.BICYCLE_ETC = tmp;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (saved === undefined) delete process.env.BICYCLE_ETC;
  else process.env.BICYCLE_ETC = saved;
});

const writeBicycleToml = (body: string) => {
  fs.writeFileSync(path.join(tmp, "bicycle.toml"), body);
};

test("no [systemd] block: no-op without throwing", async () => {
  writeBicycleToml(`[machine]\nhostname = "x"\n\n[catalog]\nurl = "x"\n`);
  await systemd.reconcile();
});

test("[systemd].enable empty: no-op without throwing", async () => {
  writeBicycleToml(`[machine]\nhostname = "x"\n[catalog]\nurl = "x"\n[systemd]\nenable = []\n`);
  await systemd.reconcile();
});
