import { test, expect } from "bun:test";
import type { Diff } from "./diff";
import * as ignore from "./ignore";

type MatchCase = {
  name: string;
  cfg: Partial<{
    files: string[];
    packages: string[];
    units: string[];
    diffs: ignore.IgnoreRule[];
  }>;
  diff: Partial<Diff> & { id: string };
  expect: { ignored: boolean };
};

const runMatchCase = (c: MatchCase) => {
  const matcher = ignore.compile(ignore.IgnoreConfig.parse(c.cfg));
  const d: Diff = {
    type: "stray",
    field: "exists",
    expected: null,
    actual: true,
    ...c.diff,
  };
  expect(matcher.ignores(d)).toBe(c.expect.ignored);
};

const MATCH_CASES: MatchCase[] = [
  {
    name: "anchored subtree pattern matches deep paths",
    cfg: { files: ["/var/**"] },
    diff: { id: "/var/lib/docker/overlay2/x" },
    expect: { ignored: true },
  },
  {
    name: "subtree pattern matches the directory node itself (prune parity)",
    cfg: { files: ["/var/**"] },
    diff: { id: "/var" },
    expect: { ignored: true },
  },
  {
    name: "subtree pattern does not match siblings sharing the prefix",
    cfg: { files: ["/var/**"] },
    diff: { id: "/var2" },
    expect: { ignored: false },
  },
  {
    name: "trailing slash is shorthand for subtree",
    cfg: { files: ["/var/"] },
    diff: { id: "/var/lib/x" },
    expect: { ignored: true },
  },
  {
    name: "single star stops at slash",
    cfg: { files: ["/etc/cni/net.d/*"] },
    diff: { id: "/etc/cni/net.d/a/b" },
    expect: { ignored: false },
  },
  {
    name: "single star matches direct children",
    cfg: { files: ["/etc/cni/net.d/*"] },
    diff: { id: "/etc/cni/net.d/10-flannel.conf" },
    expect: { ignored: true },
  },
  {
    name: "bare pattern matches any basename",
    cfg: { files: ["*.pacnew"] },
    diff: { id: "/etc/pacman.d/mirrorlist.pacnew" },
    expect: { ignored: true },
  },
  {
    name: "bare pattern does not match a suffix inside a segment",
    cfg: { files: ["*.pacnew"] },
    diff: { id: "/etc/x.pacnew/keep" },
    expect: { ignored: false },
  },
  {
    name: "unanchored segment pair matches at any boundary",
    cfg: { files: ["conf.d/*"] },
    diff: { id: "/etc/fonts/conf.d/10-hinting.conf" },
    expect: { ignored: true },
  },
  {
    name: "interior double star spans segments",
    cfg: { files: ["/usr/lib/ghc-*/lib/**"] },
    diff: { id: "/usr/lib/ghc-9.4/lib/package.conf.d/base.conf" },
    expect: { ignored: true },
  },
  {
    name: "question mark matches one non-slash char",
    cfg: { files: ["/etc/rc?.d/**"] },
    diff: { id: "/etc/rc3.d/S99local" },
    expect: { ignored: true },
  },
  {
    name: "exact pattern matches only itself",
    cfg: { files: ["/etc/machine-id"] },
    diff: { id: "/etc/machine-id" },
    expect: { ignored: true },
  },
  {
    name: "exact pattern does not match children",
    cfg: { files: ["/etc/machine-id"] },
    diff: { id: "/etc/machine-id/x" },
    expect: { ignored: false },
  },
  {
    name: "regex metacharacters in paths are literal",
    cfg: { files: ["/usr/lib/libfoo.so"] },
    diff: { id: "/usr/lib/libfooXso" },
    expect: { ignored: false },
  },
  {
    name: "files section governs pacman-file diffs",
    cfg: { files: ["/etc/sddm.conf"] },
    diff: { type: "pacman-file", id: "/etc/sddm.conf", field: "content", expected: "a", actual: "b" },
    expect: { ignored: true },
  },
  {
    name: "files section never touches the declared file kind",
    cfg: { files: ["/home/**"] },
    diff: { type: "file", id: "/home/spader/.zshrc", field: "content", expected: "a", actual: "b" },
    expect: { ignored: false },
  },
  {
    name: "package name ignored when undeclared",
    cfg: { packages: ["neofetch"] },
    diff: { type: "package", id: "neofetch", field: "installed", actual: true },
    expect: { ignored: true },
  },
  {
    name: "package glob covers debug variants",
    cfg: { packages: ["*-debug"] },
    diff: { type: "package", id: "yay-debug", field: "installed", actual: true },
    expect: { ignored: true },
  },
  {
    name: "package ignore never hides declared-but-missing",
    cfg: { packages: ["git"] },
    diff: { type: "package", id: "git", field: "installed", expected: true, actual: false },
    expect: { ignored: false },
  },
  {
    name: "unit ignored when undeclared",
    cfg: { units: ["display-manager.service"] },
    diff: { type: "unit", id: "display-manager.service", field: "enabled", actual: true },
    expect: { ignored: true },
  },
  {
    name: "unit ignore never hides declared drift",
    cfg: { units: ["sshd.service"] },
    diff: { type: "unit", id: "sshd.service", field: "enabled", expected: true, actual: false },
    expect: { ignored: false },
  },
  {
    name: "diff rule pins type, id, and field",
    cfg: { diffs: [{ type: "pacman-file", id: "/etc/sddm.conf", field: "mode" }] },
    diff: { type: "pacman-file", id: "/etc/sddm.conf", field: "mode", expected: "644", actual: "600" },
    expect: { ignored: true },
  },
  {
    name: "diff rule with field leaves other fields alone",
    cfg: { diffs: [{ type: "pacman-file", id: "/etc/sddm.conf", field: "mode" }] },
    diff: { type: "pacman-file", id: "/etc/sddm.conf", field: "content", expected: "a", actual: "b" },
    expect: { ignored: false },
  },
  {
    name: "diff rule without field covers every field",
    cfg: { diffs: [{ type: "pacman-file", id: "/etc/sddm.conf" }] },
    diff: { type: "pacman-file", id: "/etc/sddm.conf", field: "content", expected: "a", actual: "b" },
    expect: { ignored: true },
  },
  {
    name: "diff rule id is a glob",
    cfg: { diffs: [{ type: "stray", id: "/opt/containerd/**" }] },
    diff: { type: "stray", id: "/opt/containerd/bin/ctr" },
    expect: { ignored: true },
  },
  {
    name: "diff rule applies even to declared drift",
    cfg: { diffs: [{ type: "file", id: "/etc/motd", field: "mode" }] },
    diff: { type: "file", id: "/etc/motd", field: "mode", expected: "644", actual: "600" },
    expect: { ignored: true },
  },
  {
    name: "diff rule type is exact",
    cfg: { diffs: [{ type: "stray", id: "/etc/foo" }] },
    diff: { type: "pacman-file", id: "/etc/foo", field: "content", expected: "a", actual: "b" },
    expect: { ignored: false },
  },
  {
    name: "empty config ignores nothing",
    cfg: {},
    diff: { id: "/etc/anything" },
    expect: { ignored: false },
  },
];

for (const c of MATCH_CASES) {
  test(`match: ${c.name}`, () => runMatchCase(c));
}

type PruneCase = {
  name: string;
  files: string[];
  expect: { prunes: string[] };
};

const PRUNE_CASES: PruneCase[] = [
  {
    name: "subtree patterns become prunes",
    files: ["/var/cache/**", "/proc/**"],
    expect: { prunes: ["/proc", "/var/cache"] },
  },
  {
    name: "trailing slash normalizes to a prune",
    files: ["/home/"],
    expect: { prunes: ["/home"] },
  },
  {
    name: "wildcards in the prefix stay post-filter",
    files: ["/usr/lib/ghc-*/lib/**", "/usr/share/icons/*/icon-theme.cache"],
    expect: { prunes: [] },
  },
  {
    name: "exact and bare patterns are not prunes",
    files: ["/etc/machine-id", "*.pacnew"],
    expect: { prunes: [] },
  },
  {
    name: "duplicates collapse",
    files: ["/var/**", "/var/**"],
    expect: { prunes: ["/var"] },
  },
];

for (const c of PRUNE_CASES) {
  test(`prunes: ${c.name}`, () => {
    expect(ignore.prunesOf(c.files)).toEqual(c.expect.prunes);
  });
}

type ParseCase = {
  name: string;
  yml: string;
  expect: { cfg?: Partial<ignore.IgnoreConfig>; throws?: RegExp };
};

const PARSE_CASES: ParseCase[] = [
  {
    name: "empty document parses to empty config",
    yml: "",
    expect: { cfg: { files: [], packages: [], units: [], diffs: [] } },
  },
  {
    name: "sections parse and default",
    yml: "files: [/var/**]\npackages: [neofetch]\n",
    expect: { cfg: { files: ["/var/**"], packages: ["neofetch"], units: [], diffs: [] } },
  },
  {
    name: "diff rules parse",
    yml: "diffs:\n  - { type: stray, id: /opt/x, field: exists }\n",
    expect: { cfg: { diffs: [{ type: "stray", id: "/opt/x", field: "exists" }] } },
  },
  {
    name: "unknown keys are rejected",
    yml: "fils: [/var/**]\n",
    expect: { throws: /fils|unrecognized/i },
  },
  {
    name: "non-object top level is rejected",
    yml: "- /var/**\n",
    expect: { throws: /top level/ },
  },
];

for (const c of PARSE_CASES) {
  test(`parse: ${c.name}`, () => {
    if (c.expect.throws) {
      expect(() => ignore.parse(c.yml)).toThrow(c.expect.throws);
    } else {
      expect(ignore.parse(c.yml)).toMatchObject(c.expect.cfg!);
    }
  });
}

test("defaults: baseline prunes cover the runtime trees", () => {
  const matcher = ignore.compile(ignore.DEFAULTS);
  for (const p of ["/proc", "/sys", "/dev", "/run", "/tmp", "/home", "/var/lib/pacman"]) {
    expect(matcher.prunes).toContain(p);
  }
});

test("defaults: merge keeps user entries alongside the baseline", () => {
  const user = ignore.parse("files: [/swapfile]\n");
  const matcher = ignore.compile(ignore.merge(ignore.DEFAULTS, user));
  const stray = (id: string): Diff => ({ type: "stray", id, field: "exists", expected: null, actual: true });
  expect(matcher.ignores(stray("/swapfile"))).toBe(true);
  expect(matcher.ignores(stray("/etc/machine-id"))).toBe(true);
  expect(matcher.ignores(stray("/etc/motd"))).toBe(false);
});
