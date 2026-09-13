import fs from "fs";
import { test, expect } from "bun:test";
import type { Diff } from "@bicycle/shared";
import { useSandbox, writeConfig, expectDiffs, type Sandbox } from "../testing";
import { paths } from "../paths";
import * as kinds from ".";

const sb = useSandbox();

type PlanFilterCase = {
  name: string;
  config: unknown;
  ignoreYml?: string;
  only?: string[];
  expect: {
    diffs: readonly Partial<Diff>[];
    ignored: number;
  };
};

const runPlanFilterCase = async (_sb: Sandbox, c: PlanFilterCase) => {
  writeConfig(_sb, c.config);
  if (c.ignoreYml !== undefined) fs.writeFileSync(paths.etc.ignoreYaml, c.ignoreYml);
  const result = await kinds.plan(c.only);
  expectDiffs(result.diffs, c.expect.diffs);
  expect(result.ignored).toBe(c.expect.ignored);
};

const MISSING_PKG = "definitely-not-a-real-package-9b3c";

const PLAN_FILTER_CASES: PlanFilterCase[] = [
  {
    name: "no ignore.yml leaves diffs untouched",
    config: { packages: { extra: [MISSING_PKG] } },
    only: ["packages"],
    expect: {
      diffs: [{ type: "package", id: MISSING_PKG, field: "installed" }],
      ignored: 0,
    },
  },
  {
    name: "a diffs rule filters declared drift and counts it",
    config: { packages: { extra: [MISSING_PKG] } },
    ignoreYml: `diffs:\n  - { type: package, id: ${MISSING_PKG} }\n`,
    only: ["packages"],
    expect: { diffs: [], ignored: 1 },
  },
  {
    name: "packages section does not hide declared-but-missing",
    config: { packages: { extra: [MISSING_PKG] } },
    ignoreYml: `packages: [${MISSING_PKG}]\n`,
    only: ["packages"],
    expect: {
      diffs: [{ type: "package", id: MISSING_PKG, field: "installed" }],
      ignored: 0,
    },
  },
  {
    name: "only limits which kinds plan",
    config: {
      packages: { extra: [MISSING_PKG] },
      groups: [{ name: "definitely-not-a-real-group-9b3c", gid: 64999 }],
    },
    only: ["groups"],
    expect: {
      diffs: [{ type: "group", id: "definitely-not-a-real-group-9b3c", field: "exists" }],
      ignored: 0,
    },
  },
];

for (const c of PLAN_FILTER_CASES) {
  test(`plan: ${c.name}`, () => runPlanFilterCase(sb, c));
}

type ParseOnlyCase = {
  name: string;
  raw: unknown;
  expect: { names: string[]; bad: string[] };
};

const PARSE_ONLY_CASES: ParseOnlyCase[] = [
  {
    name: "empty selects every kind",
    raw: [],
    expect: { names: kinds.names(), bad: [] },
  },
  {
    name: "valid subset passes through",
    raw: ["packages", "systemd"],
    expect: { names: ["packages", "systemd"], bad: [] },
  },
  {
    name: "unknown names are rejected wholesale",
    raw: ["packages", "nope"],
    expect: { names: [], bad: ["nope"] },
  },
];

for (const c of PARSE_ONLY_CASES) {
  test(`parseOnly: ${c.name}`, () => {
    expect(kinds.parseOnly(c.raw)).toEqual(c.expect);
  });
}

type ResolveCase = {
  name: string;
  kind: string;
  diff: Diff;
  resolution: kinds.ResolutionId;
  before?: string;
  expect: {
    rejects?: RegExp;
    ignoreYml?: { contains: string[] };
  };
};

const RESOLVE_CASES: ResolveCase[] = [
  {
    name: "ignoring an undeclared package writes the packages section",
    kind: "packages",
    diff: { type: "package", id: "neofetch", field: "installed", expected: null, actual: true },
    resolution: "ignore",
    expect: { ignoreYml: { contains: ["packages:", "neofetch"] } },
  },
  {
    name: "ignoring declared drift writes a precise diffs rule",
    kind: "files",
    diff: { type: "file", id: "/etc/motd", field: "mode", expected: "644", actual: "600" },
    resolution: "ignore",
    expect: { ignoreYml: { contains: ["diffs:", "type: file", "id: /etc/motd", "field: mode"] } },
  },
  {
    name: "comments survive a programmatic append",
    kind: "packages",
    diff: { type: "package", id: "neofetch", field: "installed", expected: null, actual: true },
    resolution: "ignore",
    before: "# noise I judged\nfiles: [/swapfile]\n",
    expect: { ignoreYml: { contains: ["# noise I judged", "/swapfile", "neofetch"] } },
  },
  {
    name: "unknown kind rejects",
    kind: "nope",
    diff: { type: "package", id: "x", field: "installed", expected: null, actual: true },
    resolution: "ignore",
    expect: { rejects: /unknown kind/ },
  },
  {
    name: "adopt is not available yet",
    kind: "packages",
    diff: { type: "package", id: "x", field: "installed", expected: null, actual: true },
    resolution: "adopt",
    expect: { rejects: /M3/ },
  },
  {
    name: "apply is not offered for undeclared findings",
    kind: "packages",
    diff: { type: "package", id: "x", field: "installed", expected: null, actual: true },
    resolution: "apply",
    expect: { rejects: /not available/ },
  },
];

const runResolveCase = async (_sb: Sandbox, c: ResolveCase) => {
  if (c.before !== undefined) fs.writeFileSync(paths.etc.ignoreYaml, c.before);
  if (c.expect.rejects) {
    await expect(kinds.resolve(c.kind, c.diff, c.resolution)).rejects.toThrow(c.expect.rejects);
    return;
  }
  await kinds.resolve(c.kind, c.diff, c.resolution);
  const text = fs.readFileSync(paths.etc.ignoreYaml, "utf8");
  for (const s of c.expect.ignoreYml?.contains ?? []) expect(text).toContain(s);
};

for (const c of RESOLVE_CASES) {
  test(`resolve: ${c.name}`, () => runResolveCase(sb, c));
}

test("claims: aggregates per-kind claims with bicycle's own trees", () => {
  writeConfig(sb, { dirs: [{ path: "/media" }] });
  fs.mkdirSync(paths.state.root, { recursive: true });
  fs.writeFileSync(paths.state.filesManifest, JSON.stringify(["etc/motd", "etc/profile.d/x.sh"]));

  const c = kinds.claims();
  expect(c.prefixes).toContain(paths.etc.root);
  expect(c.prefixes).toContain(paths.state.root);
  expect(c.prefixes).toContain("/media");
  expect(c.exact).toContain("/etc/motd");
  expect(c.exact).toContain("/etc/profile.d/x.sh");
  expect(c.exact).toContain("/etc/sudoers.d/bicycle");
});

test("claims: a broken config drops dir claims but keeps the rest", () => {
  writeConfig(sb, "dirs: [\n");
  const c = kinds.claims();
  expect(c.exact).toContain("/etc/sudoers.d/bicycle");
  expect(c.prefixes).toContain(paths.etc.root);
});

test("resolve(ignore) round-trips through plan", async () => {
  writeConfig(sb, { packages: { extra: [MISSING_PKG] } });
  const before = await kinds.plan(["packages"]);
  expect(before.diffs).toHaveLength(1);
  await kinds.resolve("packages", before.diffs[0]!, "ignore");
  const after = await kinds.plan(["packages"]);
  expect(after.diffs).toHaveLength(0);
  expect(after.ignored).toBe(1);
});
