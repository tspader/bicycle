import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import * as dirs from "./dirs";

let tmp: string;
let etc: string;
let host: string;
let saved: Record<string, string | undefined> = {};

const set = (k: string, v: string) => {
  saved[k] = process.env[k];
  process.env[k] = v;
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-dirs-"));
  etc = path.join(tmp, "etc");
  host = path.join(tmp, "host");
  fs.mkdirSync(etc, { recursive: true });
  fs.mkdirSync(host, { recursive: true });
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

const writeBicycleYaml = (body: string) => {
  fs.writeFileSync(path.join(etc, "bicycle.yml"), body);
};

test("no bicycle.yml: no-op without throwing", async () => {
  await dirs.all();
});

test("no dirs block: no-op without throwing", async () => {
  writeBicycleYaml(`catalog:\n  url: "x"\n`);
  await dirs.all();
});

test("creates a directory at the requested path under HOST_ROOT", async () => {
  writeBicycleYaml(`catalog:\n  url: "x"\ndirs:\n  - { path: /media }\n`);
  await dirs.all();
  expect(fs.existsSync(path.join(host, "media"))).toBe(true);
  expect(fs.statSync(path.join(host, "media")).isDirectory()).toBe(true);
});

test("creates nested directory", async () => {
  writeBicycleYaml(`catalog:\n  url: "x"\ndirs:\n  - { path: /media/movies }\n`);
  await dirs.all();
  expect(fs.statSync(path.join(host, "media/movies")).isDirectory()).toBe(true);
});

test("applies mode on creation", async () => {
  writeBicycleYaml(`catalog:\n  url: "x"\ndirs:\n  - { path: /media, mode: "0775" }\n`);
  await dirs.all();
  const st = fs.statSync(path.join(host, "media"));
  expect(st.mode & 0o7777).toBe(0o775);
});

test("idempotent: second pass on existing dir does not throw", async () => {
  writeBicycleYaml(`catalog:\n  url: "x"\ndirs:\n  - { path: /media, mode: "0775" }\n`);
  await dirs.all();
  await dirs.all();
});

test("rejects relative path at config parse time", async () => {
  writeBicycleYaml(`catalog:\n  url: "x"\ndirs:\n  - { path: "media" }\n`);
  expect(dirs.all()).rejects.toThrow();
});

test("unknown owner: still creates dir, skips chown", async () => {
  writeBicycleYaml(`catalog:\n  url: "x"\ndirs:\n  - { path: /media, owner: "definitely-not-a-real-user-9b3c" }\n`);
  await dirs.all();
  expect(fs.existsSync(path.join(host, "media"))).toBe(true);
});
