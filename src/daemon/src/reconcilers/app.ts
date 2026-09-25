import { $ } from "bun";
import fs from "fs";
import { paths } from "../paths";
import * as config from "../config";
import { interpolate } from "../interpolate";
import { bin } from "./bin";
import { ensure as ensureRepo } from "./git";
import * as manifest from "./manifest";
import * as network from "./network";
import * as ports from "../ports";
import { chownRecursiveIfNeeded } from "../fs";
import { log } from "../logger";

export type AppPlan = {
  name: string;
  ref: string;
  baseCompose: string;
  stateRoot: string;
  stateCompose: string;
  stateOverride: string;
  overrideContent: string | null;
  mounts: manifest.Mount[];
  http: manifest.HttpBinding | null;
  userOverride: string | null;
  projectDir: string;
  env: Record<string, string>;
};

export const resolveAppEnv = async (
  cfgEnv: Record<string, string> | undefined,
  vars: unknown,
): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfgEnv ?? {})) {
    out[k] = await interpolate(v, vars);
  }
  return out;
};

export const buildComposeArgs = (
  stateCompose: string,
  generatedOverride: string | null,
  userOverride: string | null,
): string[] => {
  const args = ["-f", stateCompose];
  if (generatedOverride) args.push("-f", generatedOverride);
  if (userOverride) args.push("-f", userOverride);
  return args;
};

export const ensureMount = (m: manifest.Mount): void => {
  fs.mkdirSync(m.hostPath, { recursive: true });
  if (!m.owner) return;
  chownRecursiveIfNeeded(m.hostPath, m.owner.uid, m.owner.gid);
};

export const plan = async (
  name: string,
  catalogUrl: string,
  vars: unknown = {},
): Promise<AppPlan | null> => {
  const etcApp = paths.etc.app(name);
  if (!fs.existsSync(etcApp.config)) return null;

  const cfg = config.app(name);
  const cache = paths.state.cache.catalog(name, cfg.ref);

  log.info(
    { app: name, ref: cfg.ref, catalog: catalogUrl },
    "app: fetching catalog",
  );
  await ensureRepo({
    repo: catalogUrl,
    ref: cfg.ref,
    dest: cache.root,
    sparse: [name],
  });

  if (!fs.existsSync(cache.compose)) {
    throw new Error(`catalog has no ${name}/compose.yml at ref ${cfg.ref}`);
  }

  const m = manifest.load(cache.manifest);
  const env = await resolveAppEnv(cfg.env, vars);
  manifest.validateEnv(m.env, env, name);

  const store = ports.read();
  let http: manifest.HttpBinding | null = null;
  if (m.http) {
    const compose = Bun.YAML.parse(fs.readFileSync(cache.compose, "utf8")) as {
      services?: manifest.ComposeServices;
    };
    manifest.validateHttp(m.http, compose.services ?? {}, name);
    http = {
      service: m.http.service,
      hostPort: ports.allocate(store, name),
      containerPort: m.http.port,
    };
  } else {
    ports.release(store, name);
  }
  ports.write(store);

  const mounts = manifest.planMounts(m, name);
  const overrideContent = manifest.generateOverride(mounts, http);

  const stateApp = paths.state.app(name);
  const userOverride = fs.existsSync(etcApp.compose) ? etcApp.compose : null;

  return {
    name,
    ref: cfg.ref,
    baseCompose: cache.compose,
    stateRoot: stateApp.root,
    stateCompose: stateApp.compose,
    stateOverride: stateApp.override,
    overrideContent,
    mounts,
    http,
    userOverride,
    projectDir: etcApp.root,
    env,
  };
};

export const execute = async (p: AppPlan): Promise<void> => {
  fs.mkdirSync(p.stateRoot, { recursive: true });
  fs.copyFileSync(p.baseCompose, p.stateCompose);

  if (p.overrideContent !== null) {
    fs.writeFileSync(p.stateOverride, p.overrideContent);
  } else if (fs.existsSync(p.stateOverride)) {
    fs.unlinkSync(p.stateOverride);
  }

  for (const m of p.mounts) ensureMount(m);

  const generated = p.overrideContent !== null ? p.stateOverride : null;
  const fileArgs = buildComposeArgs(p.stateCompose, generated, p.userOverride);

  log.info(
    { app: p.name, ref: p.ref, mounts: p.mounts.length },
    "app: docker compose up",
  );
  await $`docker compose ${fileArgs} --project-directory ${p.projectDir} -p ${p.name} up -d`
    .env({ ...process.env, ...p.env });

  log.info({ app: p.name, ref: p.ref }, "app: reconciled");
};

const catalog = (cfg: config.BicycleConfig): { url: string; vars: unknown } => {
  if (!cfg.catalog) throw new Error("bicycle.yml: missing `catalog.url`");
  return { url: cfg.catalog.url, vars: cfg.vars ?? {} };
};

const remove = async (name: string): Promise<void> => {
  const stateApp = paths.state.app(name);
  log.info({ app: name }, "app: removing");
  await $`${bin("docker")} compose -p ${name} down`.quiet();
  const store = ports.read();
  ports.release(store, name);
  ports.write(store);
  fs.unlinkSync(stateApp.compose);
  fs.rmSync(stateApp.override, { force: true });
  log.info({ app: name }, "app: removed");
};

export const one = async (name: string): Promise<void> => {
  const etcApp = paths.etc.app(name);
  if (!fs.existsSync(etcApp.config)) {
    if (fs.existsSync(paths.state.app(name).compose)) await remove(name);
    return;
  }
  try {
    await network.ensure();
    const { url, vars } = catalog(config.bicycle());
    const p = await plan(name, url, vars);
    if (p) await execute(p);
  } catch (e) {
    log.error({ err: e, app: name }, "app: reconcile failed");
    throw e;
  }
};

export const names = (): string[] =>
  fs.existsSync(paths.etc.apps)
    ? fs.readdirSync(paths.etc.apps).filter((name) => {
        const app = paths.etc.app(name);
        return fs.statSync(app.root).isDirectory() && fs.existsSync(app.config);
      })
    : [];

export const all = async (): Promise<void> => {
  const cfg = config.maybe();
  if (!cfg) return;
  const declared = names();
  if (declared.length > 0) {
    const { url, vars } = catalog(cfg);
    await network.ensure();

    for (const name of declared) {
      try {
        const p = await plan(name, url, vars);
        if (p) await execute(p);
      } catch (e) {
        log.error({ err: e, app: name }, "app: reconcile failed");
        throw e;
      }
    }
  }

  const orphans = fs.existsSync(paths.state.apps)
    ? fs.readdirSync(paths.state.apps).filter(
        (name) => !declared.includes(name) && fs.existsSync(paths.state.app(name).compose),
      )
    : [];

  for (const name of orphans) {
    try {
      await remove(name);
    } catch (e) {
      log.error({ err: e, app: name }, "app: remove failed");
      throw e;
    }
  }
};
