import { ignore, type Detector, type Diff } from "@bicycle/shared";
import * as reconcilers from "../reconcilers";
import * as detect from "../detect";
import * as ignorefile from "../ignorefile";
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
  render: { line: (d: Diff) => string };
  resolutions: (d: Diff) => ResolutionId[];
};

const fromReconciler = (
  name: reconcilers.ReconcilerName,
  mod: { plan: () => Promise<Diff[]>; all: () => Promise<void> },
): Kind => ({
  name,
  cost: "cheap",
  plan: () => mod.plan(),
  apply: () => mod.all(),
  render: { line: render.line },
  resolutions: (d) => (d.expected === null ? ["adopt", "ignore"] : ["apply", "ignore"]),
});

const fromDetector = (det: Detector): Kind => ({
  name: det.name,
  cost: "expensive",
  plan: async () => detect.scanstore.read(det.name)?.diffs ?? [],
  render: { line: render.line },
  resolutions: () => ["adopt", "ignore"],
});

const BUILTIN: Kind[] = [
  fromReconciler("groups", reconcilers.groups),
  fromReconciler("users", reconcilers.users),
  fromReconciler("sudoers", reconcilers.sudoers),
  fromReconciler("dirs", reconcilers.dirs),
  fromReconciler("files", reconcilers.files),
  fromReconciler("packages", reconcilers.packages),
  fromReconciler("systemd", reconcilers.systemd),
];

export const all = (): Kind[] => {
  const out = [...BUILTIN];
  const seen = new Set(out.map((k) => k.name));
  for (const det of detect.detectors()) {
    if (!seen.has(det.name)) out.push(fromDetector(det));
  }
  return out;
};

export const names = (): string[] => all().map((k) => k.name);

export const byName = (name: string): Kind | undefined => all().find((k) => k.name === name);

export const parseOnly = (raw: unknown): { names: string[]; bad: string[] } => {
  const list = (Array.isArray(raw) ? raw : [raw]).filter((v) => v != null).map(String);
  if (list.length === 0) return { names: names(), bad: [] };
  const known = new Set(names());
  const bad = list.filter((n) => !known.has(n));
  return bad.length > 0 ? { names: [], bad } : { names: list, bad: [] };
};

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
    if (k.cost === "expensive") {
      entry.scannedAt = detect.scanstore.read(k.name)?.finishedAt ?? null;
    }
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
