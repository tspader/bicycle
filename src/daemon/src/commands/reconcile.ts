import type { Command } from "@spader/zargs";
import * as reconcilers from "../reconcilers";
import { withLock } from "../lock";
import { paths } from "../paths";

const reconcile = async () => {
  await reconcilers.files.reconcile();
  await reconcilers.network.reconcile();
  await reconcilers.app.reconcile();
};

export const command: Command = {
  description: "Reconcile all state to desired and exit",
  summary: "One-shot reconcile",
  handler: async () => {
    try {
      const result = await withLock(paths.run.reconcileLock, reconcile);
      if (result === null) {
        console.log("reconcile already running, skipping");
      }
    } catch (e) {
      const err = e as Error;
      console.error(`reconcile failed: ${err.message}`);
      if (err.stack) console.error(err.stack);
      process.exit(1);
    }
  },
};
