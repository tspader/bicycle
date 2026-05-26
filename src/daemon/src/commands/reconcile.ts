import type { Command } from "@spader/zargs";
import * as reconcilers from "../reconcilers";
import { withLock } from "../lock";
import { paths } from "../paths";

const reconcile = async () => {
  await reconcilers.network.reconcile();
  await reconcilers.app.reconcile();
};

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
