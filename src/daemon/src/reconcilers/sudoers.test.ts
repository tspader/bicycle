import { test, expect } from "bun:test";
import fs from "fs";
import { useSandbox, runReconcilerCase, writeConfig, backdate, type ReconcilerCase } from "../testing";
import * as sudoers from "./sudoers";

const sb = useSandbox();

const hasVisudo = Bun.which("visudo") !== null;

type RuleCase = {
  name: string;
  sudo: "none" | "password" | "passwordless";
  rule: string | null;
};

const RULE_CASES: RuleCase[] = [
  { name: "none yields no rule", sudo: "none", rule: null },
  { name: "password yields a full rule", sudo: "password", rule: "a ALL=(ALL:ALL) ALL" },
  { name: "passwordless yields NOPASSWD", sudo: "passwordless", rule: "a ALL=(ALL:ALL) NOPASSWD: ALL" },
];

for (const c of RULE_CASES) {
  test(`ruleFor: ${c.name}`, () => {
    expect(sudoers.ruleFor({ name: "a", sudo: c.sudo })).toBe(c.rule);
  });
}

test("rulesFor keeps only sudoers, preserving order", () => {
  expect(sudoers.rulesFor([
    { name: "a", sudo: "password" },
    { name: "b", sudo: "none" },
    { name: "c", sudo: "passwordless" },
  ])).toEqual([
    "a ALL=(ALL:ALL) ALL",
    "c ALL=(ALL:ALL) NOPASSWD: ALL",
  ]);
});

const DROP_IN = "etc/sudoers.d/bicycle";

const CASES: ReconcilerCase[] = [
  {
    name: "no bicycle.yml: no-op",
    actions: [{ do: "sweep" }],
    fs: [{ path: DROP_IN, absent: true }],
    plan: [],
  },
  {
    name: "no sudo users and no drop-in is clean",
    actions: [
      { do: "config", config: { users: [{ name: "bob", sudo: "none", groups: [] }] } },
      { do: "sweep" },
    ],
    fs: [{ path: DROP_IN, absent: true }],
    plan: [],
  },
  {
    name: "no sudo users: removes a stale drop-in",
    actions: [
      { do: "host", rel: DROP_IN, contents: "stale\n" },
      { do: "config", config: { users: [{ name: "bob", sudo: "none", groups: [] }] } },
      { do: "sweep" },
    ],
    fs: [{ path: DROP_IN, absent: true }],
    plan: [],
  },
  {
    name: "plan: stale drop-in with no sudo users yields an exists diff",
    actions: [
      { do: "host", rel: DROP_IN, contents: "stale\n" },
      { do: "config", config: { users: [{ name: "bob", sudo: "none", groups: [] }] } },
    ],
    plan: [{ type: "file", id: DROP_IN, field: "exists", expected: false, actual: true }],
  },
  {
    name: "plan: sudo user with no drop-in yields a content diff",
    actions: [
      { do: "config", config: { users: [{ name: "alice", sudo: "password", groups: [] }] } },
    ],
    plan: [
      {
        type: "file",
        id: DROP_IN,
        field: "content",
        expected: "b36f8829084b847e622ef0d22aa32ba8b47a43ef28148f378b3963a34579a5f1",
        actual: null,
      },
    ],
  },
  {
    name: "visudo-rejected update leaves the last valid drop-in",
    needs: "visudo",
    actions: [
      { do: "config", config: { users: [{ name: "alice", sudo: "password", groups: [] }] } },
      { do: "sweep" },
      { do: "config", config: { users: [{ name: "a b", sudo: "password", groups: [] }] } },
      { do: "sweep" },
    ],
    fs: [
      {
        path: DROP_IN,
        mode: 0o440,
        contents: "# Managed by Bicycle. Do not edit.\nalice ALL=(ALL:ALL) ALL\n",
      },
      { path: `${DROP_IN}.tmp`, absent: true },
    ],
    plan: [{ type: "file", id: DROP_IN, field: "content" }],
  },
  {
    name: "repairs a manually edited drop-in",
    needs: "visudo",
    actions: [
      { do: "config", config: { users: [{ name: "alice", sudo: "password", groups: [] }] } },
      { do: "sweep" },
      { do: "chmodHost", rel: DROP_IN, mode: 0o640 },
      { do: "host", rel: DROP_IN, contents: "# Managed by Bicycle. Do not edit.\nalice ALL=(ALL:ALL) NOPASSWD: ALL\n" },
      { do: "sweep" },
    ],
    fs: [
      {
        path: DROP_IN,
        mode: 0o440,
        contents: "# Managed by Bicycle. Do not edit.\nalice ALL=(ALL:ALL) ALL\n",
      },
    ],
    plan: [],
  },
  {
    name: "writes a validated drop-in for sudo users",
    needs: "visudo",
    actions: [
      {
        do: "config",
        config: {
          users: [
            { name: "alice", sudo: "password", groups: ["wheel"] },
            { name: "deploy", sudo: "passwordless", groups: [] },
            { name: "bob", sudo: "none", groups: [] },
          ],
        },
      },
      { do: "sweep" },
    ],
    fs: [
      {
        path: DROP_IN,
        mode: 0o440,
        contents:
          "# Managed by Bicycle. Do not edit.\n" +
          "alice ALL=(ALL:ALL) ALL\n" +
          "deploy ALL=(ALL:ALL) NOPASSWD: ALL\n",
      },
    ],
    plan: [],
  },
];

for (const c of CASES) {
  test.skipIf(c.needs === "visudo" && !hasVisudo)(c.name, () =>
    runReconcilerCase(sb, sudoers, sudoers.all, c),
  );
}

test.skipIf(!hasVisudo)("idempotent: unchanged config does not rewrite", async () => {
  writeConfig(sb, { users: [{ name: "alice", sudo: "password", groups: [] }] });
  await sudoers.all();
  const dropIn = sb.hostPath(DROP_IN);
  const stamp = backdate(dropIn);
  await sudoers.all();
  expect(fs.statSync(dropIn).mtimeMs).toBe(stamp);
});
