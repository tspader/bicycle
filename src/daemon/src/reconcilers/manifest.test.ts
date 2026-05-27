import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import * as manifest from "./manifest";

let tmp: string;
let savedVar: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-manifest-"));
  savedVar = process.env.BICYCLE_VAR;
  process.env.BICYCLE_VAR = path.join(tmp, "var");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (savedVar === undefined) delete process.env.BICYCLE_VAR;
  else process.env.BICYCLE_VAR = savedVar;
});

const writeManifest = (name: string, body: string): string => {
  const p = path.join(tmp, `${name}.yml`);
  fs.writeFileSync(p, body);
  return p;
};

test("load: returns {} when manifest file absent", () => {
  expect(manifest.load(path.join(tmp, "nope.yml"))).toEqual({});
});

test("load: returns {} for empty file", () => {
  expect(manifest.load(writeManifest("a", ""))).toEqual({});
});

test("load: parses services and env sections", () => {
  const p = writeManifest("a", `
services:
  db:
    data:
      - path: /var/lib/postgresql/data
        owner: "999:999"
env:
  required: [A, B]
  optional: [C]
`);
  const m = manifest.load(p);
  expect(m.services?.db?.data).toEqual([
    { path: "/var/lib/postgresql/data", owner: "999:999" },
  ]);
  expect(m.env).toEqual({ required: ["A", "B"], optional: ["C"] });
});

test("load: rejects non-mapping top-level", () => {
  const p = writeManifest("a", "- 1\n- 2\n");
  expect(() => manifest.load(p)).toThrow(/must be a YAML mapping/);
});

test("parseOwner: valid uid:gid", () => {
  expect(manifest.parseOwner("999:1000")).toEqual({ uid: 999, gid: 1000 });
});

test("parseOwner: trims whitespace", () => {
  expect(manifest.parseOwner("  0:0  ")).toEqual({ uid: 0, gid: 0 });
});

test("parseOwner: rejects malformed", () => {
  expect(() => manifest.parseOwner("999")).toThrow(/expected "uid:gid"/);
  expect(() => manifest.parseOwner("abc:def")).toThrow();
  expect(() => manifest.parseOwner("999:")).toThrow();
});

test("planMounts: empty manifest yields no mounts", () => {
  expect(manifest.planMounts({}, "x")).toEqual([]);
});

test("planMounts: single entry produces expected host path", () => {
  const mounts = manifest.planMounts(
    { services: { app: { data: [{ path: "/app/data", owner: "1:2" }] } } },
    "myapp",
  );
  expect(mounts).toEqual([
    {
      service: "app",
      hostPath: path.join(tmp, "var", "apps", "myapp", "app", "data"),
      containerPath: "/app/data",
      owner: { uid: 1, gid: 2 },
    },
  ]);
});

test("planMounts: multiple entries for one service", () => {
  const mounts = manifest.planMounts(
    { services: { caddy: { data: [{ path: "/data" }, { path: "/config" }] } } },
    "caddy",
  );
  expect(mounts.map((m) => m.hostPath)).toEqual([
    path.join(tmp, "var", "apps", "caddy", "caddy", "data"),
    path.join(tmp, "var", "apps", "caddy", "caddy", "config"),
  ]);
  expect(mounts.every((m) => m.owner === undefined)).toBe(true);
});

test("planMounts: multiple services", () => {
  const mounts = manifest.planMounts(
    {
      services: {
        web: { data: [{ path: "/srv" }] },
        db: { data: [{ path: "/var/lib/postgresql/data" }] },
      },
    },
    "miniflux",
  );
  expect(mounts.map((m) => `${m.service}:${m.hostPath}`)).toEqual([
    `web:${path.join(tmp, "var", "apps", "miniflux", "web", "srv")}`,
    `db:${path.join(tmp, "var", "apps", "miniflux", "db", "data")}`,
  ]);
});

test("planMounts: rejects relative container path", () => {
  expect(() =>
    manifest.planMounts({ services: { x: { data: [{ path: "data" }] } } }, "a"),
  ).toThrow(/absolute container path/);
});

test("planMounts: rejects root-only container path", () => {
  expect(() =>
    manifest.planMounts({ services: { x: { data: [{ path: "/" }] } } }, "a"),
  ).toThrow(/cannot derive host subdir/);
});

test("generateOverride: returns null for empty mounts", () => {
  expect(manifest.generateOverride([])).toBeNull();
});

test("generateOverride: single mount produces parseable yaml/json", () => {
  const out = manifest.generateOverride([
    { service: "app", hostPath: "/h/data", containerPath: "/app/data" },
  ]);
  const parsed = Bun.YAML.parse(out!);
  expect(parsed).toEqual({
    services: {
      app: {
        volumes: [{ type: "bind", source: "/h/data", target: "/app/data" }],
      },
    },
  });
});

test("generateOverride: multiple entries same service grouped under one volumes list", () => {
  const out = manifest.generateOverride([
    { service: "caddy", hostPath: "/h/data", containerPath: "/data" },
    { service: "caddy", hostPath: "/h/config", containerPath: "/config" },
  ]);
  const parsed = Bun.YAML.parse(out!) as any;
  expect(Object.keys(parsed.services)).toEqual(["caddy"]);
  expect(parsed.services.caddy.volumes).toHaveLength(2);
  expect(parsed.services.caddy.volumes[0]).toEqual({
    type: "bind", source: "/h/data", target: "/data",
  });
  expect(parsed.services.caddy.volumes[1]).toEqual({
    type: "bind", source: "/h/config", target: "/config",
  });
});

test("generateOverride: multiple services emit distinct service blocks", () => {
  const out = manifest.generateOverride([
    { service: "web", hostPath: "/h/web", containerPath: "/srv" },
    { service: "db", hostPath: "/h/db", containerPath: "/var/lib/postgresql/data" },
  ]);
  const parsed = Bun.YAML.parse(out!) as any;
  expect(Object.keys(parsed.services).sort()).toEqual(["db", "web"]);
});

test("validateEnv: undefined spec is a no-op", () => {
  expect(() => manifest.validateEnv(undefined, {}, "x")).not.toThrow();
});

test("validateEnv: all required present", () => {
  expect(() =>
    manifest.validateEnv({ required: ["A", "B"] }, { A: "1", B: "2", C: "3" }, "x"),
  ).not.toThrow();
});

test("validateEnv: missing var lists app name and missing keys", () => {
  expect(() =>
    manifest.validateEnv({ required: ["A", "B", "C"] }, { A: "1" }, "myapp"),
  ).toThrow(/app "myapp" missing required env: B, C/);
});

test("validateEnv: optional is informational only", () => {
  expect(() =>
    manifest.validateEnv({ optional: ["X"] }, {}, "x"),
  ).not.toThrow();
});
