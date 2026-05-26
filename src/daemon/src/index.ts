import { Hono } from "hono";
import { sValidator } from "@hono/standard-validator";
import { resolve } from "node:path";
import { FindingBatch } from "@bicycle/shared/findings";
import { Policy, lookupPolicy } from "@bicycle/shared/policy";

const configDir = resolve(process.env.BICYCLE_CONFIG_DIR ?? "/etc/bicycle");
const policyPath = `${configDir}/policy.toml`;

const rawPolicy = await import(policyPath, { with: { type: "toml" } })
  .then((m) => m.default ?? m)
  .catch((e) => {
    console.warn(`[policy] could not load ${policyPath}: ${e.message}`);
    return {};
  });

const policy = Policy.parse(rawPolicy);
console.log(`[policy] loaded from ${policyPath}`);
console.log(`[policy] ${JSON.stringify(policy.scope)}`);

const app = new Hono();

app.get("/healthz", (c) => c.text("ok"));

app.post("/v1/findings", sValidator("json", FindingBatch), async (c) => {
  const batch = c.req.valid("json");
  for (const f of batch.findings) {
    const entry = lookupPolicy(policy, f.scope, f.kind);
    const decision = entry
      ? `${entry.mode}${entry.action ? `/${entry.action}` : ""}`
      : "approve (default)";
    console.log(
      `[finding] scope=${f.scope} kind=${f.kind} subject=${f.subject} → ${decision}`,
    );
  }
  return c.json({ received: batch.findings.length }, 202);
});

const port = Number(process.env.PORT ?? 7777);
const hostname = process.env.HOST ?? "127.0.0.1";

console.log(`bicycle daemon listening on http://${hostname}:${port}`);

export default {
  port,
  hostname,
  fetch: app.fetch,
};
