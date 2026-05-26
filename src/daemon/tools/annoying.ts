import { FindingBatch } from "@bicycle/shared/findings";

const DAEMON = process.env.BICYCLE_DAEMON ?? "http://127.0.0.1:7777";

const batch: FindingBatch = {
  findings: [
    {
      scope: "annoying",
      subject: "/tmp/annoying-thing",
      owner: null,
      kind: "extra",
      data: {
        message: "i am here and i am annoying",
        nonce: crypto.randomUUID(),
      },
      occurred_at: Math.floor(Date.now() / 1000),
    },
  ],
};

const parsed = FindingBatch.parse(batch);

const res = await fetch(`${DAEMON}/v1/findings`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(parsed),
});

const body = await res.text();
console.log(`${res.status} ${body}`);
if (!res.ok) process.exit(1);
