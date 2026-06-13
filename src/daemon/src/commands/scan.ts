import type { Command } from "@spader/zargs";
import * as detect from "../detect";
import * as ignorefile from "../ignorefile";
import { paths } from "../paths";
import { log } from "../logger";

const parseOnly = (raw: unknown): { dets: detect.Detector[]; bad: string[] } => {
  const list = (Array.isArray(raw) ? raw : [raw]).filter((v) => v != null).map(String);
  const all = detect.detectors();
  if (list.length === 0) return { dets: all, bad: [] };
  const known = new Map(all.map((d) => [d.name, d]));
  const bad = list.filter((n) => !known.has(n));
  if (bad.length > 0) return { dets: [], bad };
  return { dets: list.map((n) => known.get(n)!), bad: [] };
};

export const command: Command = {
  description:
    "Run exec detectors (the fs scanner and any configured ones) and persist " +
    "their findings for `bicycle diff`. Detection is explicit: diff only ever " +
    "reads the last scan.",
  summary: "Refresh expensive system scans",
  options: {
    only: {
      type: "array",
      description: `detectors to run (any of: ${detect.detectors().map((d) => d.name).join(", ")})`,
    },
    "timeout-mins": {
      type: "number",
      description: "per-detector timeout in minutes",
      default: 60,
    },
    foreground: {
      type: "boolean",
      description: "run at full scheduling priority instead of idle",
      default: false,
    },
  },
  handler: async (argv) => {
    const { dets, bad } = parseOnly(argv.only);
    if (bad.length > 0) {
      log.error({ bad, valid: detect.detectors().map((d) => d.name) }, "scan: unknown detector(s)");
      process.exitCode = 2;
      return;
    }

    const tty = process.stderr.isTTY;
    const outcomes = await detect.scan({
      dets,
      ignores: ignorefile.effective(),
      foreground: Boolean(argv.foreground),
      timeoutMs: Number(argv["timeout-mins"]) * 60_000,
      onProgress: (name, p) => {
        if (!tty) return;
        const total = p.total !== undefined ? `/${p.total}` : "";
        process.stderr.write(`\r\x1b[2K${name}: ${p.done}${total} ${p.msg ?? ""}`);
      },
    });
    if (tty) process.stderr.write("\r\x1b[2K");

    if (outcomes === null) {
      log.error({ lock: paths.run.scanLock }, "scan: another scan is already running");
      process.exitCode = 1;
      return;
    }
    for (const o of outcomes) {
      if (o.error) console.log(`${o.detector}: failed (${o.error.message})`);
      else console.log(`${o.detector}: ${o.findings} finding(s)`);
    }
    process.exitCode = outcomes.some((o) => o.error) ? 1 : 0;
  },
};
