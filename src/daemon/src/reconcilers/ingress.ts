import { $ } from "bun";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { AppConfig, Diff, Ingress } from "@bicycle/shared";
import * as config from "../config";
import { env } from "../env";
import { writeAtomic } from "../fs";
import { log } from "../logger";
import { paths } from "../paths";
import * as ports from "../ports";
import type { Claims } from "../detect/claims";
import * as app from "./app";
import { bin } from "./bin";
import * as hosts from "./hosts";

export type Route = { name: string; port: number };
export type App = { name: string; config: AppConfig; port: number };

export const routes = (ingress: Ingress, apps: App[]): Route[] => {
  const labeled = [
    ...Object.entries(ingress.routes ?? {}).map(([name, port]) => ({
      name,
      port,
      source: "ingress.routes",
    })),
    ...apps
      .filter((a) => a.config.expose !== false)
      .map((a) => ({ name: a.config.host ?? a.name, port: a.port, source: `app "${a.name}"` })),
  ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (let i = 1; i < labeled.length; i++) {
    const prev = labeled[i - 1]!;
    const cur = labeled[i]!;
    if (prev.name === cur.name) {
      throw new Error(
        `ingress: route "${cur.name}" declared by both ${prev.source} and ${cur.source}`,
      );
    }
  }
  return labeled.map(({ name, port }) => ({ name, port }));
};

export const render = (domain: string, routes: Route[]): string =>
  routes
    .map((r) => `http://${r.name}.${domain} {\n\treverse_proxy 127.0.0.1:${r.port}\n}\n`)
    .join("\n");

const HOSTS = "etc/hosts";
const CONTAINER = "bicycle-ingress";
const PROJECT = "bicycle-ingress";
const IMAGE = "caddy:2.10";
const CADDY_DIR = "/etc/caddy";
const CADDYFILE = `${CADDY_DIR}/Caddyfile`;
const STATUS_FORMAT = "{{.State.Status}}";

type Observed = {
  routes: Route[];
  compose: { path: string; want: string; current: string | null };
  caddyfile: { path: string; want: string; current: string | null };
  hosts: { path: string; block: string; want: string; current: string };
  status: string | null;
};

const sha = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

const read = (p: string): string | null => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);

export const current = (ingress: Ingress): Route[] => {
  const store = ports.read();
  const apps = app.names().flatMap((name) => {
    const port = store[name];
    return port === undefined ? [] : [{ name, config: config.app(name), port }];
  });
  return routes(ingress, apps);
};

const observe = async (ingress: Ingress): Promise<Observed> => {
  const table = current(ingress);

  const state = paths.state.ingress;
  const compose =
    JSON.stringify(
      {
        services: {
          caddy: {
            image: IMAGE,
            container_name: CONTAINER,
            network_mode: "host",
            restart: "unless-stopped",
            volumes: [
              `${state.caddy}:${CADDY_DIR}:ro`,
              `${state.data}:/data`,
              `${state.config}:/config`,
            ],
          },
        },
      },
      null,
      2,
    ) + "\n";

  const hostsPath = path.join(env.HOST_ROOT, HOSTS);
  const hostsCurrent = read(hostsPath) ?? "";
  const block = hosts.block(table.map((r) => `${r.name}.${ingress.domain}`));

  const inspect = await $`${bin("docker")} inspect --format ${STATUS_FORMAT} ${CONTAINER}`
    .quiet()
    .nothrow();

  return {
    routes: table,
    compose: { path: state.compose, want: compose, current: read(state.compose) },
    caddyfile: {
      path: state.caddyfile,
      want: render(ingress.domain, table),
      current: read(state.caddyfile),
    },
    hosts: {
      path: hostsPath,
      block,
      want: hosts.splice(hostsCurrent, block),
      current: hostsCurrent,
    },
    status: inspect.exitCode === 0 ? inspect.stdout.toString().trim() : null,
  };
};

export const plan = async (): Promise<Diff[]> => {
  const cfg = config.maybe();
  if (!cfg?.ingress) return [];
  const o = await observe(cfg.ingress);
  const diffs: Diff[] = [];
  if (o.compose.current !== o.compose.want) {
    diffs.push({
      type: "ingress",
      id: "compose.yml",
      field: "content",
      expected: sha(o.compose.want),
      actual: o.compose.current === null ? null : sha(o.compose.current),
    });
  }
  if (o.caddyfile.current !== o.caddyfile.want) {
    diffs.push({
      type: "ingress",
      id: "Caddyfile",
      field: "content",
      expected: sha(o.caddyfile.want),
      actual: o.caddyfile.current === null ? null : sha(o.caddyfile.current),
    });
  }
  if (o.status !== "running") {
    diffs.push({ type: "ingress", id: "caddy", field: "status", expected: "running", actual: o.status });
  }
  if (o.hosts.current !== o.hosts.want) {
    diffs.push({
      type: "file",
      id: HOSTS,
      field: "content",
      expected: sha(o.hosts.want),
      actual: sha(o.hosts.current),
    });
  }
  return diffs;
};

export const all = async (): Promise<void> => {
  const cfg = config.maybe();
  if (!cfg?.ingress) return;
  const o = await observe(cfg.ingress);
  const state = paths.state.ingress;
  fs.mkdirSync(state.root, { recursive: true });
  fs.mkdirSync(state.caddy, { recursive: true });
  fs.mkdirSync(state.data, { recursive: true });
  fs.mkdirSync(state.config, { recursive: true });

  if (o.compose.current !== o.compose.want) {
    writeAtomic(o.compose.path, o.compose.want);
    log.info({ dest: o.compose.path }, "ingress: wrote compose.yml");
  }

  const caddyfileDrifted = o.caddyfile.current !== o.caddyfile.want;
  if (caddyfileDrifted) {
    writeAtomic(o.caddyfile.path, o.caddyfile.want);
    log.info({ dest: o.caddyfile.path, routes: o.routes.length }, "ingress: wrote Caddyfile");
  }

  const up = await $`${bin("docker")} compose -f ${o.compose.path} -p ${PROJECT} up -d`
    .quiet()
    .nothrow();
  if (up.exitCode !== 0) {
    log.error(
      { exitCode: up.exitCode, stderr: up.stderr.toString().trim() },
      "ingress: docker compose up failed",
    );
    return;
  }

  if (caddyfileDrifted && o.status === "running") {
    const reload = await $`${bin("docker")} exec ${CONTAINER} caddy reload --config ${CADDYFILE}`
      .quiet()
      .nothrow();
    if (reload.exitCode !== 0) {
      log.error(
        { exitCode: reload.exitCode, stderr: reload.stderr.toString().trim() },
        "ingress: caddy reload failed",
      );
    } else {
      log.info({ routes: o.routes.length }, "ingress: caddy reloaded");
    }
  }

  if (o.hosts.current !== o.hosts.want) {
    try {
      fs.mkdirSync(path.dirname(o.hosts.path), { recursive: true });
      writeAtomic(o.hosts.path, o.hosts.want);
      log.info({ dest: o.hosts.path, names: o.routes.length }, "ingress: wrote hosts");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EACCES" && code !== "EPERM") throw e;
      log.warn(
        { dest: o.hosts.path, block: o.hosts.block },
        "ingress: hosts not writable; run the daemon as root",
      );
    }
  }
};

export const claims = (): Claims => ({
  exact: [path.join("/", HOSTS)],
  prefixes: [],
});
