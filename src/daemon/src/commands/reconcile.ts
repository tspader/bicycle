import type { Command } from "@spader/zargs";
import { reconcile } from "../reconcilers/app";
import { withLock } from "../lock";
import { paths } from "../paths";

export const command: Command = {
  description: "Reconcile all state to desired and exit",
  summary: "One-shot reconcile",
  handler: async () => {
    const result = await withLock(paths.run.reconcileLock, reconcile);
    if (result === null) {
      console.log("reconcile already running, skipping");
    }
  },
};
