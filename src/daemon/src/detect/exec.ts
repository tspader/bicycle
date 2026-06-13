import { z } from "zod";
import { DiffSchema, type Detector, type Diff } from "@bicycle/shared";
import { log } from "../logger";

const DiffLine = DiffSchema.extend({ t: z.literal("diff") }).strict();

const ProgressLine = z
  .object({
    t: z.literal("progress"),
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().optional(),
    msg: z.string().optional(),
  })
  .strict();

const LogLine = z
  .object({
    t: z.literal("log"),
    level: z.enum(["debug", "info", "warn", "error"]),
    msg: z.string(),
  })
  .strict();

export type Progress = z.infer<typeof ProgressLine>;

export type RunOpts = {
  env: Record<string, string>;
  timeoutMs?: number;
  graceMs?: number;
  onProgress?: (p: Progress) => void;
};

export type RunResult = {
  diffs: Diff[];
  malformed: number;
};

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_GRACE_MS = 5_000;

const toDiff = (line: z.infer<typeof DiffLine>): Diff => ({
  type: line.type,
  id: line.id,
  field: line.field,
  expected: line.expected,
  actual: line.actual,
  ...(line.meta !== undefined ? { meta: line.meta } : {}),
  ...(line.redacted !== undefined ? { redacted: line.redacted } : {}),
});

export const run = async (detector: Detector, opts: RunOpts): Promise<RunResult> => {
  const proc = Bun.spawn(detector.exec, {
    env: { ...process.env, ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
    setTimeout(() => proc.kill("SIGKILL"), opts.graceMs ?? DEFAULT_GRACE_MS).unref();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const diffs: Diff[] = [];
  let malformed = 0;

  const handle = (line: string) => {
    if (line.trim() === "") return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      malformed += 1;
      return;
    }
    const t =
      raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>).t : undefined;
    switch (t) {
      case "diff": {
        const parsed = DiffLine.safeParse(raw);
        if (parsed.success) diffs.push(toDiff(parsed.data));
        else malformed += 1;
        return;
      }
      case "progress": {
        const parsed = ProgressLine.safeParse(raw);
        if (parsed.success) opts.onProgress?.(parsed.data);
        else malformed += 1;
        return;
      }
      case "log": {
        const parsed = LogLine.safeParse(raw);
        if (parsed.success) log[parsed.data.level]({ detector: detector.name }, parsed.data.msg);
        else malformed += 1;
        return;
      }
      default:
        return;
    }
  };

  const stderrText = new Response(proc.stderr).text();

  const reader = proc.stdout.getReader();
  const consume = (async () => {
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
      }
    }
    buf += decoder.decode();
    if (buf.trim() !== "") handle(buf);
  })();

  const exitCode = await proc.exited;
  clearTimeout(timer);

  let drained = true;
  const drainTimer = setTimeout(() => {
    drained = false;
    void reader.cancel();
  }, opts.graceMs ?? DEFAULT_GRACE_MS);
  await consume.catch(() => {});
  clearTimeout(drainTimer);
  if (!drained) {
    log.warn({ detector: detector.name }, "detector left stdout open; output truncated");
  }

  if (exitCode !== 0 || timedOut) {
    const text = await Promise.race([
      stderrText,
      new Promise<string>((r) => setTimeout(() => r(""), opts.graceMs ?? DEFAULT_GRACE_MS)),
    ]);
    const stderr = text.trim().split("\n").slice(-5).join("\n");
    const why = timedOut
      ? `timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`
      : `exited ${exitCode}`;
    throw new Error(`detector ${detector.name} ${why}${stderr ? `: ${stderr}` : ""}`);
  }
  if (malformed > 0) {
    log.warn({ detector: detector.name, malformed }, "detector emitted malformed lines");
  }
  return { diffs, malformed };
};
