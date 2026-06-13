import { z } from "zod";

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type DiffValue = string | number | boolean | string[] | null;

export const JsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonSchema),
    z.record(z.string(), JsonSchema),
  ]),
);

export const DiffValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

export const DiffSchema = z
  .object({
    type: z.string().min(1),
    id: z.string().min(1),
    field: z.string().min(1),
    expected: DiffValueSchema,
    actual: DiffValueSchema,
    meta: z.record(z.string(), JsonSchema).optional(),
    redacted: z.boolean().optional(),
  })
  .strict();

export type Diff = {
  type: string;
  id: string;
  field: string;
  expected: DiffValue;
  actual: DiffValue;
  meta?: Record<string, Json>;
  redacted?: boolean;
};
