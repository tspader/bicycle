import type { Command } from "@spader/zargs";
import { log } from "../logger";

const DAEMON_URL = process.env.BICYCLE_DAEMON_URL ?? "http://127.0.0.1:7777";

export const command: Command = {
  description: "Request a reconcile from the running daemon",
  summary: "Reconcile via daemon",
  handler: async () => {
    let res: Response;
    try {
      res = await fetch(`${DAEMON_URL}/reconcile`, { method: "POST" });
    } catch (e) {
      log.error({ err: e as Error, url: DAEMON_URL }, "reconcile: daemon unreachable");
      process.exit(1);
    }
    if (!res.ok) {
      log.error({ status: res.status, url: DAEMON_URL }, "reconcile: daemon returned error");
      process.exit(1);
    }
    log.info("reconcile: requested via daemon");
  },
};
