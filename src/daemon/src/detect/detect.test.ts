import fs from "fs";
import os from "os";
import path from "path";
import { test, expect, beforeEach, afterEach } from "bun:test";
import type { Detector, Diff } from "@bicycle/shared";
import { ignore } from "@bicycle/shared";
import { useSandbox, writeConfig, expectDiffs } from "../testing";
import { paths } from "../paths";
import * as detect from ".";
import * as kinds from "../kinds";

let scriptDir = "";
beforeEach(() => {
  scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-detect-"));
});
afterEach(() => {
  fs.rmSync(scriptDir, { recursive: true, force: true });
});

type ExecCase = {
  name: string;
  script: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  graceMs?: number;
  expect: {
    diffs?: readonly Partial<Diff>[];
    malformed?: number;
    progress?: readonly { done: number }[];
    throws?: RegExp;
  };
};

const runExecCase = async (c: ExecCase) => {
  const file = path.join(scriptDir, "detector.sh");
  fs.writeFileSync(file, `#!/bin/bash\n${c.script}\n`, { mode: 0o755 });
  const det: Detector = { name: "fake", exec: [file] };
  const progress: { done: number }[] = [];
  const promise = detect.exec.run(det, {
    env: c.env ?? {},
    timeoutMs: c.timeoutMs,
    graceMs: c.graceMs,
    onProgress: (p) => progress.push({ done: p.done }),
  });
  if (c.expect.throws) {
    await expect(promise).rejects.toThrow(c.expect.throws);
    return;
  }
  const result = await promise;
  if (c.expect.diffs) expectDiffs(result.diffs, c.expect.diffs);
  if (c.expect.malformed !== undefined) expect(result.malformed).toBe(c.expect.malformed);
  if (c.expect.progress) expect(progress).toEqual([...c.expect.progress]);
};

const DIFF_LINE = `{"t":"diff","type":"stray","id":"/etc/x","field":"exists","expected":null,"actual":true}`;

const EXEC_CASES: ExecCase[] = [
  {
    name: "diff lines parse, meta and redacted ride along",
    script: `
echo '${DIFF_LINE}'
echo '{"t":"diff","type":"pacman-file","id":"/etc/sddm.conf","field":"content","expected":"aa","actual":"bb","meta":{"pkg":"sddm"},"redacted":true}'
`,
    expect: {
      diffs: [
        { type: "stray", id: "/etc/x", field: "exists", expected: null, actual: true },
        {
          type: "pacman-file",
          id: "/etc/sddm.conf",
          field: "content",
          meta: { pkg: "sddm" },
          redacted: true,
        },
      ],
      malformed: 0,
    },
  },
  {
    name: "progress lines reach the callback in order",
    script: `
echo '{"t":"progress","done":1,"total":10}'
echo '{"t":"progress","done":2,"msg":"/usr/lib/x"}'
echo '${DIFF_LINE}'
`,
    expect: { diffs: [{ id: "/etc/x" }], progress: [{ done: 1 }, { done: 2 }] },
  },
  {
    name: "log lines and unknown tags are not findings",
    script: `
echo '{"t":"log","level":"warn","msg":"skipping /weird"}'
echo '{"t":"telemetry","whatever":1}'
echo '${DIFF_LINE}'
`,
    expect: { diffs: [{ id: "/etc/x" }], malformed: 0 },
  },
  {
    name: "malformed lines are counted, not fatal",
    script: `
echo 'not json at all'
echo '{"t":"diff","type":"stray"}'
echo '${DIFF_LINE}'
`,
    expect: { diffs: [{ id: "/etc/x" }], malformed: 2 },
  },
  {
    name: "a final unterminated line still parses",
    script: `printf '%s' '${DIFF_LINE}'`,
    expect: { diffs: [{ id: "/etc/x" }] },
  },
  {
    name: "stderr is debug, not findings",
    script: `
echo "free-form debug" >&2
echo '${DIFF_LINE}'
`,
    expect: { diffs: [{ id: "/etc/x" }] },
  },
  {
    name: "nonzero exit discards results and surfaces stderr",
    script: `
echo '${DIFF_LINE}'
echo "disk exploded" >&2
exit 3
`,
    expect: { throws: /exited 3.*disk exploded/s },
  },
  {
    name: "timeout kills the detector and fails the run",
    script: `sleep 30`,
    timeoutMs: 250,
    graceMs: 250,
    expect: { throws: /timed out/ },
  },
  {
    name: "contract env vars reach the detector",
    script: `echo "{\\"t\\":\\"diff\\",\\"type\\":\\"env\\",\\"id\\":\\"$BICYCLE_IGNORES\\",\\"field\\":\\"claims\\",\\"expected\\":null,\\"actual\\":\\"$BICYCLE_CLAIMS\\"}"`,
    env: { BICYCLE_IGNORES: "/run/x/ignores.txt", BICYCLE_CLAIMS: "/run/x/claims.txt" },
    expect: {
      diffs: [{ type: "env", id: "/run/x/ignores.txt", actual: "/run/x/claims.txt" }],
    },
  },
];

for (const c of EXEC_CASES) {
  test(`exec: ${c.name}`, () => runExecCase(c));
}

type IgnoresRenderCase = {
  name: string;
  files: string[];
  expect: { lines: string[] };
};

const IGNORES_RENDER_CASES: IgnoresRenderCase[] = [
  {
    name: "prunes first, then globs, all patterns retained",
    files: ["/var/**", "*.pacnew", "/usr/share/icons/*/icon-theme.cache"],
    expect: {
      lines: [
        "P /var",
        "G /var/**",
        "G *.pacnew",
        "G /usr/share/icons/*/icon-theme.cache",
      ],
    },
  },
  {
    name: "empty config renders empty",
    files: [],
    expect: { lines: [] },
  },
];

for (const c of IGNORES_RENDER_CASES) {
  test(`ignores: ${c.name}`, () => {
    const cfg = ignore.IgnoreConfig.parse({ files: c.files });
    const text = detect.renderIgnores(cfg);
    expect(text.split("\n").filter((l) => l !== "")).toEqual(c.expect.lines);
  });
}

const sb = useSandbox();

test("claims: manifest targets, sudoers, dirs, and bicycle's own trees", () => {
  writeConfig(sb, { dirs: [{ path: "/media" }] });
  fs.mkdirSync(paths.state.root, { recursive: true });
  fs.writeFileSync(paths.state.filesManifest, JSON.stringify(["etc/motd", "etc/profile.d/x.sh"]));

  const c = detect.claims.gather();
  expect(c.prefixes).toContain(paths.etc.root);
  expect(c.prefixes).toContain(paths.state.root);
  expect(c.prefixes).toContain("/media");
  expect(c.exact).toContain("/etc/motd");
  expect(c.exact).toContain("/etc/profile.d/x.sh");
  expect(c.exact).toContain("/etc/sudoers.d/bicycle");

  const rendered = detect.claims.render(c);
  expect(rendered).toContain("P /media\n");
  expect(rendered).toContain("E /etc/motd\n");
});

test("scanstore: round-trips and survives garbage", () => {
  const record: detect.scanstore.ScanRecord = {
    detector: "fs",
    startedAt: "2026-06-11T00:00:00.000Z",
    finishedAt: "2026-06-11T00:05:00.000Z",
    diffs: [{ type: "stray", id: "/etc/x", field: "exists", expected: null, actual: true }],
  };
  detect.scanstore.write(record);
  expect(detect.scanstore.read("fs")).toEqual(record);
  expect(fs.existsSync(`${paths.state.scan("fs")}.tmp`)).toBe(false);

  fs.writeFileSync(paths.state.scan("fs"), "not json");
  expect(detect.scanstore.read("fs")).toBeNull();
  expect(detect.scanstore.read("never-ran")).toBeNull();
});

test("registry: persisted scans surface through plan and obey ignore.yml", async () => {
  writeConfig(sb, {});
  detect.scanstore.write({
    detector: "fs",
    startedAt: "2026-06-11T00:00:00.000Z",
    finishedAt: "2026-06-11T00:05:00.000Z",
    diffs: [
      { type: "stray", id: "/swapfile", field: "exists", expected: null, actual: true },
      { type: "stray", id: "/opt/thing", field: "exists", expected: null, actual: true },
    ],
  });
  fs.writeFileSync(paths.etc.ignoreYaml, "files: [/swapfile]\n");

  const result = await kinds.plan(["fs"]);
  expectDiffs(result.diffs, [{ type: "stray", id: "/opt/thing" }]);
  expect(result.ignored).toBe(1);
  expect(result.kinds[0]!.scannedAt).toBe("2026-06-11T00:05:00.000Z");
});

test("registry: a never-scanned exec kind plans empty with scannedAt null", async () => {
  writeConfig(sb, {});
  const result = await kinds.plan(["fs"]);
  expect(result.diffs).toEqual([]);
  expect(result.kinds[0]!.scannedAt).toBeNull();
});

test("registry: config detectors become kinds; builtin collisions are dropped", async () => {
  writeConfig(sb, {
    detectors: [
      { name: "brew", exec: ["/usr/bin/true"] },
      { name: "packages", exec: ["/usr/bin/true"] },
    ],
  });
  const names = kinds.names();
  expect(names).toContain("brew");
  expect(names.filter((n) => n === "packages")).toHaveLength(1);

  detect.scanstore.write({
    detector: "brew",
    startedAt: "2026-06-11T00:00:00.000Z",
    finishedAt: "2026-06-11T00:00:01.000Z",
    diffs: [{ type: "brew", id: "imagemagick", field: "installed", expected: null, actual: true }],
  });
  const result = await kinds.plan(["brew"]);
  expectDiffs(result.diffs, [{ type: "brew", id: "imagemagick" }]);
});
