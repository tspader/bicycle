import { test, expect, beforeEach, afterEach } from "bun:test";
import { paths } from "./paths";

let savedEtc: string | undefined;
let savedVar: string | undefined;
let savedRun: string | undefined;

beforeEach(() => {
  savedEtc = process.env.BICYCLE_ETC;
  savedVar = process.env.BICYCLE_VAR;
  savedRun = process.env.BICYCLE_RUN;
});

afterEach(() => {
  process.env.BICYCLE_ETC = savedEtc;
  process.env.BICYCLE_VAR = savedVar;
  process.env.BICYCLE_RUN = savedRun;
});

test("etc paths follow BICYCLE_ETC", () => {
  process.env.BICYCLE_ETC = "/tmp/x";
  expect(paths.etc.root).toBe("/tmp/x");
  expect(paths.etc.bicycleYaml).toBe("/tmp/x/bicycle.yml");
  expect(paths.etc.ageKey).toBe("/tmp/x/age.key");
  expect(paths.etc.recipients).toBe("/tmp/x/recipients");
  expect(paths.etc.files).toBe("/tmp/x/files");
  expect(paths.etc.secrets).toBe("/tmp/x/secrets");
  expect(paths.etc.secret("db/password")).toBe("/tmp/x/secrets/db/password.age");
  expect(paths.etc.apps).toBe("/tmp/x/apps");
  expect(paths.etc.app("foo").config).toBe("/tmp/x/apps/foo/config.yml");
});

test("state paths follow BICYCLE_VAR", () => {
  process.env.BICYCLE_VAR = "/tmp/y";
  expect(paths.state.root).toBe("/tmp/y");
  expect(paths.state.apps).toBe("/tmp/y/apps");
  expect(paths.state.app("foo").compose).toBe("/tmp/y/apps/foo/compose.yml");
  expect(paths.state.app("foo").override).toBe("/tmp/y/apps/foo/override.yml");
  expect(paths.state.app("foo").mount("db", "data")).toBe("/tmp/y/apps/foo/db/data");
  const cache = paths.state.cache.catalog("foo", "abc");
  expect(cache.root).toBe("/tmp/y/cache/catalog/foo/abc");
  expect(cache.compose).toBe("/tmp/y/cache/catalog/foo/abc/foo/compose.yml");
  expect(cache.manifest).toBe("/tmp/y/cache/catalog/foo/abc/foo/bicycle.yml");
});

test("run paths follow BICYCLE_RUN", () => {
  process.env.BICYCLE_RUN = "/tmp/z";
  expect(paths.run.root).toBe("/tmp/z");
  expect(paths.run.reconcileLock).toBe("/tmp/z/reconcile.lock");
});

test("getters re-read env on each access (no stale cache)", () => {
  process.env.BICYCLE_ETC = "/tmp/a";
  expect(paths.etc.bicycleYaml).toBe("/tmp/a/bicycle.yml");
  process.env.BICYCLE_ETC = "/tmp/b";
  expect(paths.etc.bicycleYaml).toBe("/tmp/b/bicycle.yml");
});
