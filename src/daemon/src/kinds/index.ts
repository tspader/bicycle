import { ignore, type Detector, type Diff } from "@bicycle/shared";
import * as reconcilers from "../reconcilers";
import * as detect from "../detect";
import * as ignorefile from "../ignorefile";
import { paths } from "../paths";
import { log } from "../logger";
import * as render from "./render";

export type Cost = "cheap" | "expensive";
export type ResolutionId = "ignore" | "apply" | "adopt";

export type PlanCtx = {
  ignores: ignore.IgnoreMatcher;
};

export type Kind = {
  name: string;
  cost: Cost;
  plan: (ctx: PlanCtx) => Promise<Diff[]>;
  apply?: () => Promise<void>;
  claims?: () => detect.claims.Claims;
  scannedAt?: () => string | null;
  render: { line: (d: Diff) => string };
  resolutions: (d: Diff) => ResolutionId[];
};

const fromReconciler = (
  name: reconcilers.ReconcilerName,
  mod: {
    plan: () => Promise<Diff[]>;
    all: () => Promise<void>;
    claims?: () => detect.claims.Claims;
  },
): Kind => ({
  name,
  cost: "cheap",
  plan: () => mod.plan(),
  apply: () => mod.all(),
  claims: mod.claims,
  render: { line: render.line },
  resolutions: (d) => (d.expected === null ? ["adopt", "ignore"] : ["apply", "ignore"]),
});

const fromDetector = (det: Detector): Kind => {
  let record: detect.scanstore.ScanRecord | null | undefined;
  const scan = () => (record === undefined ? (record = detect.scanstore.read(det.name)) : record);
  return {
    name: det.name,
    cost: "expensive",
    plan: async () => scan()?.diffs ?? [],
    scannedAt: () => scan()?.finishedAt ?? null,
    render: { line: render.line },
    resolutions: () => ["adopt", "ignore"],
  };
};

const BUILTIN = (): Kind[] => [
  fromReconciler("groups", reconcilers.groups),
  fromReconciler("users", reconcilers.users),
  fromReconciler("sudoers", reconcilers.sudoers),
  fromReconciler("dirs", reconcilers.dirs),
  fromReconciler("files", reconcilers.files),
  fromReconciler("packages", reconcilers.packages),
  fromReconciler("systemd", reconcilers.systemd),
];

export const all = (): Kind[] => {
  const out = BUILTIN();
  const seen = new Set(out.map((k) => k.name));
  for (const det of detect.detectors()) {
    if (!seen.has(det.name)) out.push(fromDetector(det));
  }
  return out;
};

export const names = (): string[] => all().map((k) => k.name);

export const byName = (name: string): Kind | undefined => all().find((k) => k.name === name);

export const claims = (): detect.claims.Claims => {
  const exact = new Set<string>();
  const prefixes = new Set<string>([paths.etc.root, paths.state.root]);
  for (const k of all()) {
    if (!k.claims) continue;
    try {
      const c = k.claims();
      for (const p of c.exact) exact.add(p);
      for (const p of c.prefixes) prefixes.add(p);
    } catch (e) {
      log.warn({ err: e, kind: k.name }, "kinds: claims unavailable");
    }
  }
  return { exact: [...exact].sort(), prefixes: [...prefixes].sort() };
};

export const parseNames = (
  raw: unknown,
  known: readonly string[],
): { names: string[]; bad: string[] } => {
  const list = (Array.isArray(raw) ? raw : [raw]).filter((v) => v != null).map(String);
  if (list.length === 0) return { names: [...known], bad: [] };
  const set = new Set(known);
  const bad = list.filter((n) => !set.has(n));
  return bad.length > 0 ? { names: [], bad } : { names: list, bad: [] };
};

export const parseOnly = (raw: unknown): { names: string[]; bad: string[] } =>
  parseNames(raw, names());

export type KindPlan = {
  kind: string;
  diffs: Diff[];
  scannedAt?: string | null;
};

export type PlanResult = {
  kinds: KindPlan[];
  diffs: Diff[];
  ignored: number;
};

export const plan = async (only?: readonly string[]): Promise<PlanResult> => {
  const matcher = ignore.compile(ignorefile.effective());
  const ctx: PlanCtx = { ignores: matcher };
  const want = only && only.length > 0 ? new Set(only) : null;

  const kinds: KindPlan[] = [];
  let ignored = 0;
  for (const k of all()) {
    if (want && !want.has(k.name)) continue;
    const kept: Diff[] = [];
    for (const d of await k.plan(ctx)) {
      if (matcher.ignores(d)) ignored += 1;
      else kept.push(d);
    }
    const entry: KindPlan = { kind: k.name, diffs: kept };
    if (k.scannedAt) entry.scannedAt = k.scannedAt();
    kinds.push(entry);
  }
  return { kinds, diffs: kinds.flatMap((e) => e.diffs), ignored };
};

export const resolve = async (
  kindName: string,
  d: Diff,
  resolution: ResolutionId,
): Promise<boolean> => {
  const kind = byName(kindName);
  if (!kind) throw new Error(`unknown kind: ${kindName}`);
  if (!kind.resolutions(d).includes(resolution)) {
    throw new Error(`resolution "${resolution}" not available for ${d.type} ${d.id} ${d.field}`);
  }
  switch (resolution) {
    case "ignore":
      return ignorefile.addForDiff(d);
    case "apply":
      await kind.apply?.();
      return true;
    case "adopt":
      throw new Error("adopt lands in M3");
  }
};
