import { Hono } from "hono";
import type { Command } from "@spader/zargs";
import { log } from "../logger";

export const command: Command = {
  description: "Run the long-running bicycle daemon HTTP server",
  summary: "Start the daemon",
  options: {
    port: {
      type: "number",
      description: "HTTP port to listen on",
      default: 7777,
    },
    host: {
      type: "string",
      description: "Address to bind",
      default: "127.0.0.1",
    },
  },
  handler: (argv) => {
    const app = new Hono();
    app.get("/healthz", (c) => c.text("ok"));

    const port = Number(argv.port);
    const hostname = String(argv.host);

    log.info({ host: hostname, port }, "bicycle daemon listening");

    Bun.serve({
      port,
      hostname,
      fetch: app.fetch,
    });
  },
};
