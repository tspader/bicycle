import type { Command } from "@spader/zargs";
import type { Diff, DiffValue } from "@bicycle/shared";
import * as reconcilers from "../reconcilers";
import { parseOnly } from "./only";
import { log } from "../logger";

const SHA256_HEX = /^[0-9a-f]{64}$/;

const fmt = (v: DiffValue): string => {
  if (v === null) return "<none>";
  if (Array.isArray(v)) return v.join(",");
  if (typeof v === "string" && SHA256_HEX.test(v)) return `sha256:${v.slice(0, 12)}`;
  return String(v);
};

export const render = (d: Diff): string =>
  `~ ${d.type} ${d.id} ${d.field}: ${fmt(d.actual)} -> ${fmt(d.expected)}${d.redacted ? " (redacted)" : ""}`;

export const command: Command = {
  description:
    "Show divergences between declared and actual state without changing anything. " +
    "Use --only to plan a subset; exits 1 when diffs exist, 0 when clean.",
  summary: "Show what reconcile would change",
  options: {
    only: {
      type: "array",
      description: `reconcilers to plan (any of: ${reconcilers.PLANNABLE.join(", ")})`,
    },
    json: {
      type: "boolean",
      description: "emit one JSON diff per line instead of human-readable output",
      default: false,
    },
  },
  handler: async (argv) => {
    const { names, bad } = parseOnly(argv.only);
    if (bad.length > 0) {
      log.error({ bad, valid: reconcilers.PLANNABLE }, "diff: unknown reconciler name(s)");
      process.exitCode = 2;
      return;
    }

    const diffs = await reconcilers.plan(names);
    if (argv.json) {
      for (const d of diffs) console.log(JSON.stringify(d));
    } else {
      for (const d of diffs) console.log(render(d));
      console.log(diffs.length === 0 ? "clean" : `${diffs.length} diff(s)`);
    }
    process.exitCode = diffs.length === 0 ? 0 : 1;
  },
};
