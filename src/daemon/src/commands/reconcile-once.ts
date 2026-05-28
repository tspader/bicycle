import type { Command } from "@spader/zargs";
import * as reconcilers from "../reconcilers";
import { log } from "../logger";

// One-shot, in-process reconcile of a subset of reconcilers, then exit. Unlike
// `reconcile` (which pings a running daemon over HTTP), this runs the reconcile
// logic directly — used by the installer inside `arch-chroot /mnt` to populate
// the target before first boot, when no daemon is running yet.
export const command: Command = {
  description:
    "Run reconcilers once in-process and exit (no daemon required). " +
    "Use --only to run a subset; defaults to a full sweep.",
  summary: "One-shot local reconcile",
  options: {
    only: {
      type: "array",
      description: `reconcilers to run (any of: ${reconcilers.ORDER.join(", ")})`,
    },
  },
  handler: async (argv) => {
    const raw = argv.only as unknown;
    let names: readonly reconcilers.ReconcilerName[] = reconcilers.ORDER;
    if (raw !== undefined) {
      const list = (Array.isArray(raw) ? raw : [raw]).map(String);
      const bad = list.filter((n) => !reconcilers.isReconcilerName(n));
      if (bad.length > 0) {
        log.error(
          { bad, valid: reconcilers.ORDER },
          "reconcile-once: unknown reconciler name(s)",
        );
        process.exit(2);
      }
      names = list as reconcilers.ReconcilerName[];
    }
    log.info({ names }, "reconcile-once: running");
    await reconcilers.run(names);
    log.info("reconcile-once: done");
  },
};
