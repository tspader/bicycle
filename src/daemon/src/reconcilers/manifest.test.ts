import { test, expect } from "bun:test";
import { $ } from "bun";
import fs from "fs";
import path from "path";
import { useSandbox } from "../testing";
import * as manifest from "./manifest";

const sb = useSandbox();

const hasDockerCompose = await (async () => {
  const r = await $`docker compose version`.quiet().nothrow();
  return r.exitCode === 0;
})();

type LoadCase = {
  name: string;
  yml?: string;
  expect?: unknown;
  throws?: RegExp;
};

const LOAD_CASES: LoadCase[] = [
  {
    name: "returns {} when manifest file absent",
    expect: {},
  },
  {
    name: "returns {} for empty file",
    yml: "",
    expect: {},
  },
  {
    name: "parses services and env sections",
    yml: `
services:
  db:
    data:
      - path: /var/lib/postgresql/data
        owner: "999:999"
env:
  required: [A, B]
  optional: [C]
`,
    expect: {
      services: {
        db: { data: [{ path: "/var/lib/postgresql/data", owner: "999:999" }] },
      },
      env: { required: ["A", "B"], optional: ["C"] },
    },
  },
  {
    name: "rejects non-mapping top-level",
    yml: "- 1\n- 2\n",
    throws: /must be a YAML mapping/,
  },
  {
    name: "rejects unknown top-level key (typo catch)",
    yml: "datas: []\n",
    throws: /unknown key "datas"/,
  },
  {
    name: "rejects unknown key inside services.<svc>",
    yml: "services:\n  db:\n    dat:\n      - path: /x\n",
    throws: /services\.db: unknown key "dat"/,
  },
  {
    name: "rejects unknown key inside data entry",
    yml: `
services:
  db:
    data:
      - path: /x
        owner: "1:1"
        mod: "0755"
`,
    throws: /services\.db\.data\[0\]: unknown key "mod"/,
  },
  {
    name: "rejects unknown key inside env",
    yml: "env:\n  requried: [X]\n",
    throws: /env: unknown key "requried"/,
  },
];

for (const c of LOAD_CASES) {
  test(`load: ${c.name}`, () => {
    const p = path.join(sb.root, "manifest.yml");
    if (c.yml !== undefined) fs.writeFileSync(p, c.yml);
    if (c.throws) expect(() => manifest.load(p)).toThrow(c.throws);
    else expect(manifest.load(p)).toEqual(c.expect as ReturnType<typeof manifest.load>);
  });
}

type OwnerCase = {
  name: string;
  owner: string;
  expect?: { uid: number; gid: number };
  throws?: RegExp | true;
};

const OWNER_CASES: OwnerCase[] = [
  { name: "valid uid:gid", owner: "999:1000", expect: { uid: 999, gid: 1000 } },
  { name: "trims whitespace", owner: "  0:0  ", expect: { uid: 0, gid: 0 } },
  { name: "rejects missing gid", owner: "999", throws: /expected "uid:gid"/ },
  { name: "rejects non-numeric", owner: "abc:def", throws: true },
  { name: "rejects empty gid", owner: "999:", throws: true },
];

for (const c of OWNER_CASES) {
  test(`parseOwner: ${c.name}`, () => {
    if (c.throws) {
      const m = expect(() => manifest.parseOwner(c.owner));
      if (c.throws === true) m.toThrow();
      else m.toThrow(c.throws);
    } else {
      expect(manifest.parseOwner(c.owner)).toEqual(c.expect!);
    }
  });
}

type MountExpect = {
  service: string;
  hostRel: string;
  containerPath: string;
  owner?: { uid: number; gid: number };
};

type MountsCase = {
  name: string;
  manifest: Parameters<typeof manifest.planMounts>[0];
  app: string;
  expect?: MountExpect[];
  throws?: RegExp;
};

const MOUNTS_CASES: MountsCase[] = [
  {
    name: "empty manifest yields no mounts",
    manifest: {},
    app: "x",
    expect: [],
  },
  {
    name: "single entry produces expected host path",
    manifest: { services: { app: { data: [{ path: "/app/data", owner: "1:2" }] } } },
    app: "myapp",
    expect: [
      {
        service: "app",
        hostRel: "apps/myapp/app/data",
        containerPath: "/app/data",
        owner: { uid: 1, gid: 2 },
      },
    ],
  },
  {
    name: "multiple entries for one service",
    manifest: { services: { caddy: { data: [{ path: "/data" }, { path: "/config" }] } } },
    app: "caddy",
    expect: [
      { service: "caddy", hostRel: "apps/caddy/caddy/data", containerPath: "/data" },
      { service: "caddy", hostRel: "apps/caddy/caddy/config", containerPath: "/config" },
    ],
  },
  {
    name: "multiple services",
    manifest: {
      services: {
        web: { data: [{ path: "/srv" }] },
        db: { data: [{ path: "/var/lib/postgresql/data" }] },
      },
    },
    app: "miniflux",
    expect: [
      { service: "web", hostRel: "apps/miniflux/web/srv", containerPath: "/srv" },
      { service: "db", hostRel: "apps/miniflux/db/data", containerPath: "/var/lib/postgresql/data" },
    ],
  },
  {
    name: "rejects relative container path",
    manifest: { services: { x: { data: [{ path: "data" }] } } },
    app: "a",
    throws: /absolute container path/,
  },
  {
    name: "rejects root-only container path",
    manifest: { services: { x: { data: [{ path: "/" }] } } },
    app: "a",
    throws: /cannot derive host subdir/,
  },
];

for (const c of MOUNTS_CASES) {
  test(`planMounts: ${c.name}`, () => {
    if (c.throws) {
      expect(() => manifest.planMounts(c.manifest, c.app)).toThrow(c.throws);
      return;
    }
    const actual: MountExpect[] = manifest.planMounts(c.manifest, c.app).map((m) => ({
      service: m.service,
      hostRel: path.relative(sb.state, m.hostPath),
      containerPath: m.containerPath,
      ...(m.owner ? { owner: m.owner } : {}),
    }));
    expect(actual).toEqual(c.expect!);
  });
}

type OverrideCase = {
  name: string;
  mounts: manifest.Mount[];
  expect: unknown;
};

const OVERRIDE_CASES: OverrideCase[] = [
  {
    name: "returns null for empty mounts",
    mounts: [],
    expect: null,
  },
  {
    name: "single mount produces parseable yaml",
    mounts: [{ service: "app", hostPath: "/h/data", containerPath: "/app/data" }],
    expect: {
      services: {
        app: { volumes: [{ type: "bind", source: "/h/data", target: "/app/data" }] },
      },
    },
  },
  {
    name: "multiple entries same service grouped under one volumes list",
    mounts: [
      { service: "caddy", hostPath: "/h/data", containerPath: "/data" },
      { service: "caddy", hostPath: "/h/config", containerPath: "/config" },
    ],
    expect: {
      services: {
        caddy: {
          volumes: [
            { type: "bind", source: "/h/data", target: "/data" },
            { type: "bind", source: "/h/config", target: "/config" },
          ],
        },
      },
    },
  },
  {
    name: "multiple services emit distinct service blocks",
    mounts: [
      { service: "web", hostPath: "/h/web", containerPath: "/srv" },
      { service: "db", hostPath: "/h/db", containerPath: "/var/lib/postgresql/data" },
    ],
    expect: {
      services: {
        web: { volumes: [{ type: "bind", source: "/h/web", target: "/srv" }] },
        db: { volumes: [{ type: "bind", source: "/h/db", target: "/var/lib/postgresql/data" }] },
      },
    },
  },
];

for (const c of OVERRIDE_CASES) {
  test(`generateOverride: ${c.name}`, () => {
    const out = manifest.generateOverride(c.mounts);
    if (c.expect === null) expect(out).toBeNull();
    else expect(Bun.YAML.parse(out!)).toEqual(c.expect);
  });
}

type EnvCase = {
  name: string;
  spec?: { required?: string[]; optional?: string[] };
  env: Record<string, string>;
  throws?: RegExp;
};

const ENV_CASES: EnvCase[] = [
  { name: "undefined spec is a no-op", env: {} },
  {
    name: "all required present",
    spec: { required: ["A", "B"] },
    env: { A: "1", B: "2", C: "3" },
  },
  {
    name: "missing var lists app name and missing keys",
    spec: { required: ["A", "B", "C"] },
    env: { A: "1" },
    throws: /app "myapp" missing required env: B, C/,
  },
  { name: "optional is informational only", spec: { optional: ["X"] }, env: {} },
];

for (const c of ENV_CASES) {
  test(`validateEnv: ${c.name}`, () => {
    const run = () => manifest.validateEnv(c.spec, c.env, "myapp");
    if (c.throws) expect(run).toThrow(c.throws);
    else expect(run).not.toThrow();
  });
}

type ComposeCase = {
  name: string;
  base: string;
  mounts: manifest.Mount[];
  expectTargets: Record<string, string[]>;
  expectBind?: { service: string; target: string; source: string };
};

const COMPOSE_CASES: ComposeCase[] = [
  {
    name: "merges generated override into base",
    base: `
name: bicycle-test-merge
services:
  app:
    image: alpine:3
    command: ["true"]
    volumes:
      - /etc/hostname:/etc/hostname:ro
`,
    mounts: [
      { service: "app", hostPath: "/tmp/bicycle-test-merge/data", containerPath: "/data" },
    ],
    expectTargets: { app: ["/etc/hostname", "/data"] },
    expectBind: { service: "app", target: "/data", source: "/tmp/bicycle-test-merge/data" },
  },
  {
    name: "override across multiple services merges per-service",
    base: `
name: bicycle-test-multi
services:
  web:
    image: alpine:3
    command: ["true"]
  db:
    image: alpine:3
    command: ["true"]
`,
    mounts: [
      { service: "web", hostPath: "/tmp/bicycle-test-multi/web", containerPath: "/srv" },
      { service: "db", hostPath: "/tmp/bicycle-test-multi/db", containerPath: "/var/lib/db" },
    ],
    expectTargets: { web: ["/srv"], db: ["/var/lib/db"] },
  },
];

for (const c of COMPOSE_CASES) {
  test.skipIf(!hasDockerCompose)(`integration: ${c.name}`, async () => {
    const base = path.join(sb.root, "compose.yml");
    const override = path.join(sb.root, "override.yml");
    fs.writeFileSync(base, c.base);
    fs.writeFileSync(override, manifest.generateOverride(c.mounts)!);

    const r = await $`docker compose -f ${base} -f ${override} config --format json`.quiet().nothrow();
    if (r.exitCode !== 0) {
      throw new Error(`compose config failed: ${r.stderr.toString()}`);
    }
    const merged = JSON.parse(r.stdout.toString());

    for (const [service, targets] of Object.entries(c.expectTargets)) {
      const actual = merged.services[service].volumes.map((v: any) => v.target);
      for (const t of targets) expect(actual).toContain(t);
    }
    if (c.expectBind) {
      const vol = merged.services[c.expectBind.service].volumes.find(
        (v: any) => v.target === c.expectBind!.target,
      );
      expect(vol.type).toBe("bind");
      expect(vol.source).toBe(c.expectBind.source);
    }
  });
}
