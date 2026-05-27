import fs from "fs";
import path from "path";
import { Hono } from "hono";
import type { Command } from "@spader/zargs";
import * as reconcilers from "../reconcilers";
import { log } from "../logger";
import { paths } from "../paths";

type Job = () => Promise<void>;

const makeQueue = () => {
  let chain: Promise<void> = Promise.resolve();
  return (job: Job): Promise<void> => {
    const next = chain.then(async () => {
      try { await job(); } catch (e) {
        log.error({ err: e }, "daemon: job failed");
      }
    });
    chain = next;
    return next;
  };
};

const makeDebouncer = (delayMs: number, enqueue: (job: Job) => Promise<void>) => {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return (key: string, job: Job) => {
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      void enqueue(job);
    }, delayMs));
  };
};

const fullSweep: Job = async () => {
  await reconcilers.files.all();
  await reconcilers.packages.all();
  await reconcilers.systemd.all();
  await reconcilers.app.all();
};

const classify = (abs: string): Job | null => {
  const filesRoot = paths.etc.files;
  const appsRoot = paths.etc.apps;
  const secretsRoot = paths.etc.secrets;

  if (abs === paths.etc.bicycleYaml) {
    return async () => {
      log.info({ path: abs }, "daemon: bicycle.yml changed");
      await reconcilers.packages.all();
      await reconcilers.systemd.all();
      await reconcilers.app.all();
    };
  }

  if (abs.startsWith(secretsRoot + path.sep) || abs === secretsRoot) {
    return async () => {
      log.info({ path: abs }, "daemon: secret changed");
      await reconcilers.app.all();
    };
  }

  if (abs.startsWith(filesRoot + path.sep)) {
    return async () => {
      await reconcilers.files.one(abs);
    };
  }

  if (abs.startsWith(appsRoot + path.sep)) {
    const rel = path.relative(appsRoot, abs);
    const name = rel.split(path.sep)[0];
    if (!name) return null;
    const base = path.basename(abs);
    if (base !== "config.yml" && base !== "compose.yml") return null;
    return async () => {
      log.info({ app: name, path: abs }, "daemon: app input changed");
      await reconcilers.app.one(name);
    };
  }

  return null;
};

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
  handler: async (argv) => {
    fs.mkdirSync(paths.etc.root, { recursive: true });

    const enqueue = makeQueue();
    const debounce = makeDebouncer(250, enqueue);

    const watcher = fs.watch(paths.etc.root, { recursive: true }, (_eventType, filename) => {
      try {
        if (!filename) return;
        const abs = path.join(paths.etc.root, filename);
        const job = classify(abs);
        if (!job) return;
        debounce(abs, job);
      } catch (err) {
        log.error({ err, filename }, "daemon: watcher callback failed");
      }
    });
    watcher.on("error", (err) => log.error({ err }, "daemon: watcher error"));

    log.info({ etc: paths.etc.root }, "daemon: startup sweep");
    void enqueue(async () => {
      await fullSweep();
      log.info("daemon: startup sweep done");
    });

    const port = Number(argv.port);
    const hostname = String(argv.host);
    const app = new Hono();
    app.get("/healthz", (c) => c.text("ok"));
    app.post("/reconcile", async (c) => {
      log.info("daemon: manual reconcile requested");
      await enqueue(fullSweep);
      return c.json({ ok: true });
    });
    log.info({ host: hostname, port }, "bicycle daemon listening");
    Bun.serve({ port, hostname, fetch: app.fetch });
  },
};
