import { Hono } from "hono";

const app = new Hono();

app.get("/healthz", (c) => c.text("ok"));

const port = Number(process.env.PORT ?? 7777);
const hostname = process.env.HOST ?? "127.0.0.1";

console.log(`bicycle daemon listening on http://${hostname}:${port}`);

export default {
  port,
  hostname,
  fetch: app.fetch,
};
