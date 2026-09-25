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
  {
    name: "parses http section",
    yml: "http:\n  service: web\n  port: 8080\n",
    expect: { http: { service: "web", port: 8080 } },
  },
  {
    name: "rejects unknown key inside http",
    yml: "http:\n  service: web\n  prot: 8080\n",
    throws: /http: unknown key "prot"/,
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
  http: manifest.HttpBinding | null;
  expect: unknown;
};

const OVERRIDE_CASES: OverrideCase[] = [
  {
    name: "returns null for empty mounts and no http",
    mounts: [],
    http: null,
    expect: null,
  },
  {
    name: "single mount produces parseable yaml",
    mounts: [{ service: "app", hostPath: "/h/data", containerPath: "/app/data" }],
    http: null,
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
    http: null,
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
    http: null,
    expect: {
      services: {
        web: { volumes: [{ type: "bind", source: "/h/web", target: "/srv" }] },
        db: { volumes: [{ type: "bind", source: "/h/db", target: "/var/lib/postgresql/data" }] },
      },
    },
  },
  {
    name: "http without mounts yields only a loopback ports binding",
    mounts: [],
    http: { service: "web", hostPort: 20000, containerPort: 8080 },
    expect: {
      services: {
        web: { ports: ["127.0.0.1:20000:8080"] },
      },
    },
  },
  {
    name: "mounts and http on the same service share one block",
    mounts: [{ service: "web", hostPath: "/h/web", containerPath: "/srv" }],
    http: { service: "web", hostPort: 20001, containerPort: 80 },
    expect: {
      services: {
        web: {
          volumes: [{ type: "bind", source: "/h/web", target: "/srv" }],
          ports: ["127.0.0.1:20001:80"],
        },
      },
    },
  },
  {
    name: "http on a different service than the mounts yields two blocks",
    mounts: [{ service: "db", hostPath: "/h/db", containerPath: "/var/lib/db" }],
    http: { service: "web", hostPort: 20002, containerPort: 3000 },
    expect: {
      services: {
        db: { volumes: [{ type: "bind", source: "/h/db", target: "/var/lib/db" }] },
        web: { ports: ["127.0.0.1:20002:3000"] },
      },
    },
  },
];

for (const c of OVERRIDE_CASES) {
  test(`generateOverride: ${c.name}`, () => {
    const out = manifest.generateOverride(c.mounts, c.http);
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

type HttpCase = {
  name: string;
  http: manifest.HttpSpec;
  services: manifest.ComposeServices;
  throws?: RegExp;
};

const HTTP_CASES: HttpCase[] = [
  {
    name: "service present passes",
    http: { service: "web", port: 80 },
    services: { web: {}, db: {} },
  },
  {
    name: "service absent names app and lists services",
    http: { service: "nope", port: 80 },
    services: { web: {}, db: {} },
    throws: /^app "myapp": http\.service "nope" is not a service in compose\.yml \(services: web, db\)$/,
  },
  {
    name: "publishing an unrelated port passes",
    http: { service: "web", port: 9091 },
    services: { web: { ports: ["51413:51413/tcp", "51413:51413/udp"] } },
  },
  {
    name: "publishing the http port on another service passes",
    http: { service: "web", port: 80 },
    services: { web: {}, db: { ports: ["80:80"] } },
  },
  {
    name: "short syntax publishing the http port throws",
    http: { service: "web", port: 8000 },
    services: { web: { ports: ["8000:8000"] } },
    throws: /^app "myapp": service "web" publishes http\.port 8000 in compose\.yml ports \("8000:8000"\); ingress owns that port, remove it$/,
  },
  {
    name: "host ip and protocol suffix still resolve the container port",
    http: { service: "web", port: 8000 },
    services: { web: { ports: ["127.0.0.1:9000:8000/tcp"] } },
    throws: /publishes http\.port 8000/,
  },
  {
    name: "container-only short syntax throws",
    http: { service: "web", port: 8000 },
    services: { web: { ports: [8000] } },
    throws: /publishes http\.port 8000/,
  },
  {
    name: "range containing the http port throws",
    http: { service: "web", port: 8005 },
    services: { web: { ports: ["8000-8010:8000-8010"] } },
    throws: /publishes http\.port 8005/,
  },
  {
    name: "range excluding the http port passes",
    http: { service: "web", port: 9000 },
    services: { web: { ports: ["8000-8010:8000-8010"] } },
  },
  {
    name: "long syntax target throws",
    http: { service: "web", port: 8000 },
    services: { web: { ports: [{ target: 8000, published: "8000" }] } },
    throws: /publishes http\.port 8000/,
  },
  {
    name: "long syntax other target passes",
    http: { service: "web", port: 8000 },
    services: { web: { ports: [{ target: 9000, published: "9000" }] } },
  },
];

for (const c of HTTP_CASES) {
  test(`validateHttp: ${c.name}`, () => {
    const run = () => manifest.validateHttp(c.http, c.services, "myapp");
    if (c.throws) expect(run).toThrow(c.throws);
    else expect(run).not.toThrow();
  });
}

type ComposeCase = {
  name: string;
  base: string;
  mounts: manifest.Mount[];
  http: manifest.HttpBinding | null;
  expectTargets: Record<string, string[]>;
  expectBind?: { service: string; target: string; source: string };
  expectPort?: { service: string; published: string; target: number; host_ip: string };
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
    http: null,
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
    http: null,
    expectTargets: { web: ["/srv"], db: ["/var/lib/db"] },
  },
  {
    name: "http binding publishes the container port on loopback",
    base: `
name: bicycle-test-http
services:
  web:
    image: alpine:3
    command: ["true"]
`,
    mounts: [],
    http: { service: "web", hostPort: 20000, containerPort: 8080 },
    expectTargets: {},
    expectPort: { service: "web", published: "20000", target: 8080, host_ip: "127.0.0.1" },
  },
];

for (const c of COMPOSE_CASES) {
  test.skipIf(!hasDockerCompose)(`integration: ${c.name}`, async () => {
    const base = path.join(sb.root, "compose.yml");
    const override = path.join(sb.root, "override.yml");
    fs.writeFileSync(base, c.base);
    fs.writeFileSync(override, manifest.generateOverride(c.mounts, c.http)!);

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
    if (c.expectPort) {
      const { service, ...port } = c.expectPort;
      expect(merged.services[service].ports).toContainEqual(expect.objectContaining(port));
    }
  });
}
