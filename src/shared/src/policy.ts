import { z } from "zod";

export const PolicyMode = z.enum(["auto", "approve"]);
export type PolicyMode = z.infer<typeof PolicyMode>;

export const PolicyEntry = z.object({
  mode: PolicyMode,
  action: z.string().optional(),
});
export type PolicyEntry = z.infer<typeof PolicyEntry>;

export const Policy = z.object({
  scope: z
    .record(z.string(), z.record(z.string(), PolicyEntry))
    .default({}),
});
export type Policy = z.infer<typeof Policy>;

export function lookupPolicy(
  policy: Policy,
  scope: string,
  kind: string,
): PolicyEntry | null {
  return policy.scope[scope]?.[kind] ?? null;
}
