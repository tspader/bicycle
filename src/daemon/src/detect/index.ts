import fs from "fs";
import path from "path";
import { ignore, type Detector } from "@bicycle/shared";
import * as config from "../config";
import * as lock from "../lock";
import * as exec from "./exec";
import * as claims from "./claims";
import * as scanstore from "./scanstore";
import { paths } from "../paths";
import { log } from "../logger";

export { exec, claims, scanstore };
export type { Detector };

export const FS_DETECTOR = "fs";

const builtin = (): Detector[] => [
  {
    name: FS_DETECTOR,
    exec: [process.env.BICYCLE_FS_SCANNER ?? "bicycle-fs-scan"],
  },
];

const fromConfig = (): Detector[] => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return [];
  try {
    return config.bicycle().detectors ?? [];
  } catch {
    return [];
  }
};

export const detectors = (): Detector[] => {
  const out = [...builtin()];
  const seen = new Set(out.map((d) => d.name));
  for (const det of fromConfig()) {
    if (seen.has(det.name)) {
      log.warn({ detector: det.name }, "detector name collides with a builtin; skipping");
      continue;
    }
    seen.add(det.name);
    out.push(det);
  }
  return out;
};

export const byName = (name: string): Detector | undefined =>
  detectors().find((d) => d.name === name);

export const renderIgnores = (cfg: ignore.IgnoreConfig): string => {
  const matcher = ignore.compile(cfg);
  return [
    ...matcher.prunes.map((p) => `P ${p}`),
    ...matcher.patterns.map((p) => `G ${p}`),
    "",
  ].join("\n");
};

export const writeIgnores = (cfg: ignore.IgnoreConfig): string => {
  const file = paths.run.scanIgnores;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderIgnores(cfg));
  return file;
};

export type ScanOpts = {
  dets: Detector[];
  ignores: ignore.IgnoreConfig;
  foreground?: boolean;
  timeoutMs?: number;
  onProgress?: (detector: string, p: exec.Progress) => void;
};

export type ScanOutcome = {
  detector: string;
  findings?: number;
  error?: Error;
};

export const scan = async (opts: ScanOpts): Promise<ScanOutcome[] | null> =>
  lock.withLock(paths.run.scanLock, async () => {
    const ignoresFile = writeIgnores(opts.ignores);
    const claimsFile = claims.write();
    const outcomes: ScanOutcome[] = [];

    for (const det of opts.dets) {
      const cacheDir = paths.state.detectorCache(det.name);
      fs.mkdirSync(cacheDir, { recursive: true });
      const env: Record<string, string> = {
        BICYCLE_IGNORES: ignoresFile,
        BICYCLE_CLAIMS: claimsFile,
        BICYCLE_CACHE_DIR: cacheDir,
        ...(opts.foreground ? {} : { BICYCLE_BACKGROUND: "1" }),
      };

      const startedAt = new Date().toISOString();
      try {
        const res = await exec.run(det, {
          env,
          timeoutMs: opts.timeoutMs,
          onProgress: (p) => opts.onProgress?.(det.name, p),
        });
        scanstore.write({
          detector: det.name,
          startedAt,
          finishedAt: new Date().toISOString(),
          diffs: res.diffs,
        });
        outcomes.push({ detector: det.name, findings: res.diffs.length });
      } catch (e) {
        log.error({ err: e, detector: det.name }, "scan: detector failed; previous scan kept");
        outcomes.push({ detector: det.name, error: e instanceof Error ? e : new Error(String(e)) });
      }
    }
    return outcomes;
  });
