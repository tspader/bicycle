import type { Command } from "@spader/zargs";
import * as reconcilers from "../reconcilers";
import { withLock } from "../lock";
import { log } from "../logger";
import { paths } from "../paths";

const reconcile = async () => {
  log.info("reconcile: start");
  await reconcilers.files.reconcile();
  await reconcilers.systemd.reconcile();
  await reconcilers.network.reconcile();
  await reconcilers.app.reconcile();
  log.info("reconcile: done");
};

export const command: Command = {
  description: "Reconcile all state to desired and exit",
  summary: "One-shot reconcile",
  handler: async () => {
    log.info("handler");
    try {
      const result = await withLock(paths.run.reconcileLock, reconcile);
      if (result === null) {
        log.warn({ lock: paths.run.reconcileLock }, "reconcile already running, skipping");
      }
    } catch (e) {
      const err = e as Error;
      log.error({ err }, "reconcile failed");
      process.exit(1);
    }
  },
};
