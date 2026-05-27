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

type CatalogEntry = { compose: string; bicycle?: string };

const makeCatalogRepo = async (
  entries: Record<string, CatalogEntry>,
): Promise<{ url: string; sha: string }> => {
  const repo = path.join(tmp, "catalog");
  fs.mkdirSync(repo, { recursive: true });
  for (const [name, e] of Object.entries(entries)) {
    fs.mkdirSync(path.join(repo, name), { recursive: true });
    fs.writeFileSync(path.join(repo, name, "compose.yml"), e.compose);
    if (e.bicycle) fs.writeFileSync(path.join(repo, name, "bicycle.yml"), e.bicycle);
  }
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

test("buildComposeArgs: base only when no overrides", () => {
  expect(app.buildComposeArgs("/s/compose.yml", null, null)).toEqual(["-f", "/s/compose.yml"]);
});

test("buildComposeArgs: generated then user override", () => {
  expect(app.buildComposeArgs("/s/c.yml", "/s/g.yml", "/e/u.yml")).toEqual([
    "-f", "/s/c.yml", "-f", "/s/g.yml", "-f", "/e/u.yml",
  ]);
});

test("buildComposeArgs: only generated, no user", () => {
  expect(app.buildComposeArgs("/s/c.yml", "/s/g.yml", null)).toEqual([
    "-f", "/s/c.yml", "-f", "/s/g.yml",
  ]);
});

test("buildComposeArgs: only user, no generated", () => {
  expect(app.buildComposeArgs("/s/c.yml", null, "/e/u.yml")).toEqual([
    "-f", "/s/c.yml", "-f", "/e/u.yml",
  ]);
});

test("plan: returns null when app config missing", async () => {
  fs.mkdirSync(path.join(etc, "apps", "ghost"), { recursive: true });
  expect(await app.plan("ghost", "file:///does/not/matter")).toBeNull();
});

test("plan: throws when catalog lacks <name>/compose.yml at ref", async () => {
  const { url, sha } = await makeCatalogRepo({ other: { compose: "services: {}\n" } });
  writeAppConfig("myapp", `ref: ${sha}\n`);
  await expect(app.plan("myapp", url)).rejects.toThrow(/catalog has no myapp\/compose\.yml/);
});

test("plan: no manifest yields empty mounts and null overrideContent", async () => {
  const { url, sha } = await makeCatalogRepo({
    myapp: { compose: "services:\n  myapp:\n    image: x\n" },
  });
  await writeSecret("myapp/pass", "hunter2");
  writeAppConfig("myapp", `ref: ${sha}\nenv:\n  PASS: \${secret:myapp/pass}\n  PLAIN: literal\n`);

  const p = await app.plan("myapp", url);
  expect(p).not.toBeNull();
  expect(p!.name).toBe("myapp");
  expect(p!.ref).toBe(sha);
  expect(p!.env).toEqual({ PASS: "hunter2", PLAIN: "literal" });
  expect(p!.mounts).toEqual([]);
  expect(p!.overrideContent).toBeNull();
  expect(p!.userOverride).toBeNull();
  expect(p!.stateCompose).toBe(path.join(state, "apps", "myapp", "compose.yml"));
  expect(p!.stateOverride).toBe(path.join(state, "apps", "myapp", "override.yml"));
});

test("plan: manifest populates mounts and overrideContent", async () => {
  const { url, sha } = await makeCatalogRepo({
    caddy: {
      compose: "services:\n  caddy:\n    image: caddy\n",
      bicycle: `services:
  caddy:
    data:
      - path: /data
        owner: "0:0"
      - path: /config
`,
    },
  });
  writeAppConfig("caddy", `ref: ${sha}\n`);
  const p = await app.plan("caddy", url);
  expect(p!.mounts.map((m) => m.hostPath)).toEqual([
    path.join(state, "apps", "caddy", "caddy", "data"),
    path.join(state, "apps", "caddy", "caddy", "config"),
  ]);
  expect(p!.mounts[0]!.owner).toEqual({ uid: 0, gid: 0 });
  expect(p!.mounts[1]!.owner).toBeUndefined();
  expect(p!.overrideContent).not.toBeNull();
  const parsed = Bun.YAML.parse(p!.overrideContent!) as any;
  expect(parsed.services.caddy.volumes).toHaveLength(2);
});

test("plan: missing required env throws naming app and missing keys", async () => {
  const { url, sha } = await makeCatalogRepo({
    web: {
      compose: "services:\n  web:\n    image: x\n",
      bicycle: "env:\n  required: [TOKEN, BASE_URL]\n",
    },
  });
  writeAppConfig("web", `ref: ${sha}\nenv:\n  TOKEN: t\n`);
  await expect(app.plan("web", url)).rejects.toThrow(
    /app "web" missing required env: BASE_URL/,
  );
});

test("plan: required env present passes", async () => {
  const { url, sha } = await makeCatalogRepo({
    web: {
      compose: "services:\n  web:\n    image: x\n",
      bicycle: "env:\n  required: [TOKEN]\n",
    },
  });
  writeAppConfig("web", `ref: ${sha}\nenv:\n  TOKEN: abc\n`);
  const p = await app.plan("web", url);
  expect(p!.env).toEqual({ TOKEN: "abc" });
});

test("plan: detects user override file", async () => {
  const { url, sha } = await makeCatalogRepo({
    myapp: { compose: "services:\n  myapp:\n    image: x\n" },
  });
  writeAppConfig("myapp", `ref: ${sha}\n`);
  const overridePath = path.join(etc, "apps", "myapp", "compose.yml");
  fs.writeFileSync(overridePath, "services:\n  myapp:\n    environment: {}\n");

  const p = await app.plan("myapp", url);
  expect(p!.userOverride).toBe(overridePath);
});

test("ensureMount: creates dir when absent", () => {
  const dir = path.join(tmp, "mnt", "a");
  app.ensureMount({ service: "x", hostPath: dir, containerPath: "/a" });
  expect(fs.statSync(dir).isDirectory()).toBe(true);
});

test("ensureMount: same-owner is a no-op (mtime unchanged)", () => {
  const dir = path.join(tmp, "mnt", "b");
  fs.mkdirSync(dir, { recursive: true });
  const st = fs.statSync(dir);
  const before = st.mtimeMs;
  // Backdate so any rewrite/chown is detectable.
  const old = new Date(before - 60_000);
  fs.utimesSync(dir, old, old);
  const stamp = fs.statSync(dir).mtimeMs;
  app.ensureMount({
    service: "x",
    hostPath: dir,
    containerPath: "/b",
    owner: { uid: st.uid, gid: st.gid },
  });
  expect(fs.statSync(dir).mtimeMs).toBe(stamp);
});

test("ensureMount: tolerates EPERM on chown when non-root attempts foreign uid", () => {
  const dir = path.join(tmp, "mnt", "c");
  fs.mkdirSync(dir, { recursive: true });
  if (process.getuid && process.getuid() === 0) return; // skip when running as root
  // Pick a uid we cannot become; chown will EPERM but ensureMount must swallow it.
  expect(() =>
    app.ensureMount({
      service: "x",
      hostPath: dir,
      containerPath: "/c",
      owner: { uid: 1, gid: 1 },
    }),
  ).not.toThrow();
});
