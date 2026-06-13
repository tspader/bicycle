import type { Command } from "@spader/zargs";
import * as kinds from "../kinds";
import { ago } from "../kinds/render";
import { log } from "../logger";

export const command: Command = {
  description:
    "Show divergences between declared and actual state without changing anything. " +
    "Use --only to plan a subset; exits 1 when diffs exist, 0 when clean.",
  summary: "Show what reconcile would change",
  options: {
    only: {
      type: "array",
      description: `kinds to plan (any of: ${kinds.names().join(", ")})`,
    },
    json: {
      type: "boolean",
      description: "emit one JSON diff per line instead of human-readable output",
      default: false,
    },
  },
  handler: async (argv) => {
    const { names, bad } = kinds.parseOnly(argv.only);
    if (bad.length > 0) {
      log.error({ bad, valid: kinds.names() }, "diff: unknown kind name(s)");
      process.exitCode = 2;
      return;
    }

    const result = await kinds.plan(names);
    if (argv.json) {
      for (const d of result.diffs) console.log(JSON.stringify(d));
    } else {
      for (const entry of result.kinds) {
        const line = kinds.byName(entry.kind)?.render.line;
        for (const d of entry.diffs) console.log(line ? line(d) : JSON.stringify(d));
      }
      for (const entry of result.kinds) {
        if (entry.scannedAt === undefined) continue;
        console.log(
          entry.scannedAt === null
            ? `# ${entry.kind}: never scanned — run \`bicycle scan --only ${entry.kind}\``
            : `# ${entry.kind}: scanned ${ago(entry.scannedAt)}`,
        );
      }
      const ignored = result.ignored > 0 ? ` (${result.ignored} ignored)` : "";
      console.log(
        result.diffs.length === 0 ? `clean${ignored}` : `${result.diffs.length} diff(s)${ignored}`,
      );
    }
    process.exitCode = result.diffs.length === 0 ? 0 : 1;
  },
};
