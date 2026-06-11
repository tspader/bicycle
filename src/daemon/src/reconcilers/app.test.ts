import { test, expect } from "bun:test";
import { $ } from "bun";
import fs from "fs";
import path from "path";
import { useSandbox, writeSecret, backdate } from "../testing";
import * as app from "./app";

const sb = useSandbox();

const isRoot = process.getuid !== undefined && process.getuid() === 0;

type EnvCase = {
  name: string;
  env?: Record<string, string>;
  vars?: unknown;
  secrets?: Record<string, string>;
  expect?: Record<string, string>;
  throws?: true;
};

const ENV_CASES: EnvCase[] = [
  { name: "undefined input returns empty", expect: {} },
  { name: "passes through literals", env: { A: "1", B: "two" }, expect: { A: "1", B: "two" } },
  {
    name: "interpolates ${secret:...} tokens",
    secrets: { "foo/bar": "sekret" },
    env: { X: "v=${secret:foo/bar}" },
    expect: { X: "v=sekret" },
  },
  {
    name: "missing secret propagates as error",
    env: { X: "${secret:nope}" },
    throws: true,
  },
  {
    name: "interpolates vars (scalars and nested paths)",
    env: { PUID: "${admin.uid}", TZ: "${tz}" },
    vars: { admin: { uid: 1000 }, tz: "UTC" },
    expect: { PUID: "1000", TZ: "UTC" },
  },
  {
    name: "mixes vars and secrets in one string",
    secrets: { "api/key": "k123" },
    env: { URL: "https://${host}.lan/api?k=${secret:api/key}" },
    vars: { host: "miniflux" },
    expect: { URL: "https://miniflux.lan/api?k=k123" },
  },
];

for (const c of ENV_CASES) {
  test(`resolveAppEnv: ${c.name}`, async () => {
    for (const [addr, clear] of Object.entries(c.secrets ?? {})) {
      await writeSecret(sb, addr, clear);
    }
    const run = app.resolveAppEnv(c.env, c.vars ?? {});
    if (c.throws) await expect(run).rejects.toThrow();
    else expect(await run).toEqual(c.expect!);
  });
}

type ArgsCase = {
  name: string;
  base: string;
  generated: string | null;
  user: string | null;
  expect: string[];
};

const ARGS_CASES: ArgsCase[] = [
  {
    name: "base only when no overrides",
    base: "/s/compose.yml",
    generated: null,
    user: null,
    expect: ["-f", "/s/compose.yml"],
  },
  {
    name: "generated then user override",
    base: "/s/c.yml",
    generated: "/s/g.yml",
    user: "/e/u.yml",
    expect: ["-f", "/s/c.yml", "-f", "/s/g.yml", "-f", "/e/u.yml"],
  },
  {
    name: "only generated, no user",
    base: "/s/c.yml",
    generated: "/s/g.yml",
    user: null,
    expect: ["-f", "/s/c.yml", "-f", "/s/g.yml"],
  },
  {
    name: "only user, no generated",
    base: "/s/c.yml",
    generated: null,
    user: "/e/u.yml",
    expect: ["-f", "/s/c.yml", "-f", "/e/u.yml"],
  },
];

for (const c of ARGS_CASES) {
  test(`buildComposeArgs: ${c.name}`, () => {
    expect(app.buildComposeArgs(c.base, c.generated, c.user)).toEqual(c.expect);
  });
}

type CatalogEntry = { compose: string; bicycle?: string };

const makeCatalogRepo = async (
  entries: Record<string, CatalogEntry>,
): Promise<{ url: string; sha: string }> => {
  const repo = path.join(sb.root, "catalog");
  fs.mkdirSync(repo, { recursive: true });
  for (const [name, e] of Object.entries(entries)) {
    fs.mkdirSync(path.join(repo, name), { recursive: true });
    fs.writeFileSync(path.join(repo, name, "compose.yml"), e.compose);
    if (e.bicycle) fs.writeFileSync(path.join(repo, name, "bicycle.yml"), e.bicycle);
  }
  await $`git -C ${repo} init -q -b main`.quiet();
  await $`git -C ${repo} -c user.email=t@t -c user.name=t add .`.quiet();
  await $`git -C ${repo} -c user.email=t@t -c user.name=t commit -q --allow-empty -m initial`.quiet();
  await $`git -C ${repo} config uploadpack.allowAnySHA1InWant true`.quiet();
  const sha = (await $`git -C ${repo} rev-parse HEAD`.quiet().text()).trim();
  return { url: repo, sha };
};

type PlanCase = {
  name: string;
  catalog: Record<string, CatalogEntry>;
  app: string;
  noAppConfig?: boolean;
  env?: Record<string, string>;
  userOverride?: string;
  secrets?: Record<string, string>;
  nullPlan?: boolean;
  throws?: RegExp;
  expect?: {
    env?: Record<string, string>;
    mounts?: { hostRel: string; owner?: { uid: number; gid: number } }[];
    overrideVolumes?: Record<string, number>;
  };
};

const PLAN_CASES: PlanCase[] = [
  {
    name: "returns null when app config missing",
    catalog: {},
    app: "ghost",
    noAppConfig: true,
    nullPlan: true,
  },
  {
    name: "throws when catalog lacks <name>/compose.yml at ref",
    catalog: { other: { compose: "services: {}\n" } },
    app: "myapp",
    throws: /catalog has no myapp\/compose\.yml/,
  },
  {
    name: "no manifest yields empty mounts and null overrideContent",
    catalog: { myapp: { compose: "services:\n  myapp:\n    image: x\n" } },
    app: "myapp",
    secrets: { "myapp/pass": "hunter2" },
    env: { PASS: "${secret:myapp/pass}", PLAIN: "literal" },
    expect: { env: { PASS: "hunter2", PLAIN: "literal" }, mounts: [] },
  },
  {
    name: "manifest populates mounts and overrideContent",
    catalog: {
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
    },
    app: "caddy",
    expect: {
      mounts: [
        { hostRel: "apps/caddy/caddy/data", owner: { uid: 0, gid: 0 } },
        { hostRel: "apps/caddy/caddy/config" },
      ],
      overrideVolumes: { caddy: 2 },
    },
  },
  {
    name: "missing required env throws naming app and missing keys",
    catalog: {
      web: {
        compose: "services:\n  web:\n    image: x\n",
        bicycle: "env:\n  required: [TOKEN, BASE_URL]\n",
      },
    },
    app: "web",
    env: { TOKEN: "t" },
    throws: /app "web" missing required env: BASE_URL/,
  },
  {
    name: "required env present passes",
    catalog: {
      web: {
        compose: "services:\n  web:\n    image: x\n",
        bicycle: "env:\n  required: [TOKEN]\n",
      },
    },
    app: "web",
    env: { TOKEN: "abc" },
    expect: { env: { TOKEN: "abc" } },
  },
  {
    name: "detects user override file",
    catalog: { myapp: { compose: "services:\n  myapp:\n    image: x\n" } },
    app: "myapp",
    userOverride: "services:\n  myapp:\n    environment: {}\n",
    expect: {},
  },
];

for (const c of PLAN_CASES) {
  test(`plan: ${c.name}`, async () => {
    const { url, sha } = c.nullPlan
      ? { url: "file:///does/not/matter", sha: "" }
      : await makeCatalogRepo(c.catalog);
    const appDir = path.join(sb.etc, "apps", c.app);
    fs.mkdirSync(appDir, { recursive: true });
    if (!c.noAppConfig) {
      fs.writeFileSync(
        path.join(appDir, "config.yml"),
        Bun.YAML.stringify({ ref: sha, ...(c.env ? { env: c.env } : {}) }),
      );
    }
    for (const [addr, clear] of Object.entries(c.secrets ?? {})) {
      await writeSecret(sb, addr, clear);
    }
    const overridePath = path.join(appDir, "compose.yml");
    if (c.userOverride !== undefined) fs.writeFileSync(overridePath, c.userOverride);

    if (c.throws) {
      await expect(app.plan(c.app, url)).rejects.toThrow(c.throws);
      return;
    }
    const p = await app.plan(c.app, url);
    if (c.nullPlan) {
      expect(p).toBeNull();
      return;
    }

    expect(p).not.toBeNull();
    expect(p!.name).toBe(c.app);
    expect(p!.ref).toBe(sha);
    expect(p!.stateCompose).toBe(path.join(sb.state, "apps", c.app, "compose.yml"));
    expect(p!.stateOverride).toBe(path.join(sb.state, "apps", c.app, "override.yml"));
    expect(p!.userOverride).toBe(c.userOverride !== undefined ? overridePath : null);

    if (c.expect?.env) expect(p!.env).toEqual(c.expect.env);
    if (c.expect?.mounts) {
      const actual = p!.mounts.map((m) => ({
        hostRel: path.relative(sb.state, m.hostPath),
        ...(m.owner ? { owner: m.owner } : {}),
      }));
      expect(actual).toEqual(c.expect.mounts);
    }
    if (c.expect?.overrideVolumes) {
      expect(p!.overrideContent).not.toBeNull();
      const parsed = Bun.YAML.parse(p!.overrideContent!) as any;
      for (const [service, count] of Object.entries(c.expect.overrideVolumes)) {
        expect(parsed.services[service].volumes).toHaveLength(count);
      }
    } else {
      expect(p!.overrideContent).toBeNull();
    }
  });
}

type MountCase = {
  name: string;
  pre?: { dirs?: string[]; files?: Record<string, string> };
  target: string;
  owner?: "self" | { uid: number; gid: number };
  skipIfRoot?: boolean;
  expect: { dir?: boolean; stableMtimeOf?: string };
};

const MOUNT_CASES: MountCase[] = [
  {
    name: "creates dir when absent",
    target: "mnt/a",
    expect: { dir: true },
  },
  {
    name: "same-owner is a no-op (mtime unchanged)",
    pre: { dirs: ["mnt/b"] },
    target: "mnt/b",
    owner: "self",
    expect: { stableMtimeOf: "mnt/b" },
  },
  {
    name: "tolerates EPERM on chown when non-root attempts foreign uid",
    pre: { dirs: ["mnt/c"] },
    target: "mnt/c",
    owner: { uid: 1, gid: 1 },
    skipIfRoot: true,
    expect: {},
  },
  {
    name: "recurses into pre-existing files without rewriting same-owner entries",
    pre: { dirs: ["mnt/rec/sub"], files: { "mnt/rec/sub/f.txt": "hi" } },
    target: "mnt/rec",
    owner: "self",
    expect: { stableMtimeOf: "mnt/rec/sub/f.txt" },
  },
  {
    name: "recursing with a foreign owner swallows EPERM",
    pre: { dirs: ["mnt/rec2/sub"], files: { "mnt/rec2/sub/f.txt": "hi" } },
    target: "mnt/rec2",
    owner: { uid: 1, gid: 1 },
    skipIfRoot: true,
    expect: {},
  },
];

for (const c of MOUNT_CASES) {
  test.skipIf(c.skipIfRoot === true && isRoot)(`ensureMount: ${c.name}`, () => {
    for (const d of c.pre?.dirs ?? []) {
      fs.mkdirSync(path.join(sb.root, d), { recursive: true });
    }
    for (const [rel, contents] of Object.entries(c.pre?.files ?? {})) {
      fs.writeFileSync(path.join(sb.root, rel), contents);
    }

    let stablePath: string | null = null;
    let stamp = 0;
    if (c.expect.stableMtimeOf) {
      stablePath = path.join(sb.root, c.expect.stableMtimeOf);
      stamp = backdate(stablePath);
    }

    const target = path.join(sb.root, c.target);
    const ownerOf = (p: string) => {
      const st = fs.statSync(p);
      return { uid: st.uid, gid: st.gid };
    };
    app.ensureMount({
      service: "x",
      hostPath: target,
      containerPath: "/x",
      ...(c.owner === undefined
        ? {}
        : { owner: c.owner === "self" ? ownerOf(target) : c.owner }),
    });

    if (c.expect.dir) expect(fs.statSync(target).isDirectory()).toBe(true);
    if (stablePath) expect(fs.statSync(stablePath).mtimeMs).toBe(stamp);
  });
}
