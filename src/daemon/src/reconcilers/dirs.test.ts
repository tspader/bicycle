import { test } from "bun:test";
import { useSandbox, runReconcilerCase, type ReconcilerCase } from "../testing";
import * as dirs from "./dirs";

const sb = useSandbox();

const CASES: ReconcilerCase[] = [
  {
    name: "no bicycle.yml: no-op",
    actions: [{ do: "sweep" }],
    plan: [],
  },
  {
    name: "no dirs block: no-op",
    actions: [{ do: "config", config: {} }, { do: "sweep" }],
    plan: [],
  },
  {
    name: "creates a directory at the requested path under HOST_ROOT",
    actions: [
      { do: "config", config: { dirs: [{ path: "/media" }] } },
      { do: "sweep" },
    ],
    fs: [{ path: "media", dir: true }],
  },
  {
    name: "creates nested directory",
    actions: [
      { do: "config", config: { dirs: [{ path: "/media/movies" }] } },
      { do: "sweep" },
    ],
    fs: [{ path: "media/movies", dir: true }],
  },
  {
    name: "applies mode on creation",
    actions: [
      { do: "config", config: { dirs: [{ path: "/media", mode: "0775" }] } },
      { do: "sweep" },
    ],
    fs: [{ path: "media", dir: true, mode: 0o775 }],
  },
  {
    name: "idempotent: second pass on existing dir converges",
    actions: [
      { do: "config", config: { dirs: [{ path: "/media", mode: "0775" }] } },
      { do: "sweep" },
      { do: "sweep" },
    ],
    fs: [{ path: "media", dir: true, mode: 0o775 }],
    plan: [],
  },
  {
    name: "rejects relative path at config parse time",
    actions: [
      { do: "config", config: { dirs: [{ path: "media" }] } },
      { do: "sweep" },
    ],
    rejects: true,
  },
  {
    name: "unknown owner: still creates dir, skips chown",
    actions: [
      { do: "config", config: { dirs: [{ path: "/media", owner: "definitely-not-a-real-user-9b3c" }] } },
      { do: "sweep" },
    ],
    fs: [{ path: "media", dir: true }],
  },
  {
    name: "plan: missing dir yields an exists diff",
    actions: [{ do: "config", config: { dirs: [{ path: "/media" }] } }],
    plan: [{ type: "dir", id: "/media", field: "exists", expected: true, actual: false }],
  },
  {
    name: "plan: pre-existing dir with matching mode is clean",
    actions: [
      { do: "config", config: { dirs: [{ path: "/media", mode: "0775" }] } },
      { do: "hostDir", rel: "media", mode: 0o775 },
    ],
    plan: [],
  },
  {
    name: "plan: mode mismatch yields a mode diff",
    actions: [
      { do: "config", config: { dirs: [{ path: "/media" }] } },
      { do: "sweep" },
      { do: "chmodHost", rel: "media", mode: 0o755 },
      { do: "config", config: { dirs: [{ path: "/media", mode: "0775" }] } },
    ],
    plan: [{ type: "dir", id: "/media", field: "mode", expected: "0775", actual: "0755" }],
  },
  {
    name: "fixes mode drift on an existing dir",
    actions: [
      { do: "config", config: { dirs: [{ path: "/media", mode: "0775" }] } },
      { do: "hostDir", rel: "media", mode: 0o755 },
      { do: "sweep" },
    ],
    fs: [{ path: "media", dir: true, mode: 0o775 }],
    plan: [],
  },
  {
    name: "setgid mode converges and plan drains",
    actions: [
      { do: "config", config: { dirs: [{ path: "/media", mode: "02775" }] } },
      { do: "sweep" },
    ],
    fs: [{ path: "media", dir: true, mode: 0o2775 }],
    plan: [],
  },
];

for (const c of CASES) {
  test(c.name, () => runReconcilerCase(sb, dirs, dirs.all, c));
}
