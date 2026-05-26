import { z } from "zod";

export const FindingKind = z.enum(["missing", "extra", "modified"]);
export type FindingKind = z.infer<typeof FindingKind>;

export const Finding = z.object({
  scope: z.string().min(1),
  subject: z.string().min(1),
  owner: z.string().nullish(),
  kind: FindingKind,
  data: z.record(z.string(), z.unknown()).default({}),
  occurred_at: z.number().int(),
});
export type Finding = z.infer<typeof Finding>;

export const FindingBatch = z.object({
  findings: z.array(Finding).min(1),
});
export type FindingBatch = z.infer<typeof FindingBatch>;
