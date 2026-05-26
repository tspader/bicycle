import type { Command } from "@spader/zargs";
import { reconcile } from "../reconcilers/app";

export const command: Command = {
  description: "Reconcile all app stacks to their desired state and exit",
  summary: "One-shot reconcile",
  handler: async () => {
    await reconcile();
  },
};
