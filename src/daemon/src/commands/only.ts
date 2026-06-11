import * as reconcilers from "../reconcilers";

export const parseOnly = (
  raw: unknown,
): { names: readonly reconcilers.ReconcilerName[]; bad: string[] } => {
  const list = (Array.isArray(raw) ? raw : [raw])
    .filter((v) => v != null)
    .map(String);
  if (list.length === 0) return { names: reconcilers.ORDER, bad: [] };
  const bad = list.filter((n) => !reconcilers.isReconcilerName(n));
  if (bad.length > 0) return { names: [], bad };
  return { names: list as reconcilers.ReconcilerName[], bad: [] };
};
