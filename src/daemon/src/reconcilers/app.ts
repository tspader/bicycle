import { $ } from "bun";
import fs from "fs";
import path from "path";
import { paths } from "../paths";
import * as config from "../config";
import * as secrets from "../secrets";
import { ensure as ensureRepo } from "./git";

export type AppPlan = {
  name: string;
  ref: string;
  baseCompose: string;
  stateCompose: string;
  dataDir: string;
  userOverride: string | null;
  projectDir: string;
  env: Record<string, string>;
};

export const resolveAppEnv = async (
  cfgEnv: Record<string, string> | undefined,
): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfgEnv ?? {})) {
    out[k] = await secrets.interpolate(v);
  }
  return out;
};

export const buildComposeArgs = (
  stateCompose: string,
  userOverride: string | null,
): string[] => {
  const args = ["-f", stateCompose];
  if (userOverride) args.push("-f", userOverride);
  return args;
};

export const plan = async (
  name: string,
  catalogUrl: string,
): Promise<AppPlan | null> => {
  const etcApp = paths.etc.app(name);
  if (!fs.existsSync(etcApp.config)) return null;

  const cfg = config.app(name);
  const cacheDir = paths.state.cache.catalog(name, cfg.ref);

  await ensureRepo({
    repo: catalogUrl,
    ref: cfg.ref,
    dest: cacheDir,
    sparse: [name],
  });

  const baseCompose = path.join(cacheDir, name, "compose.yml");
  if (!fs.existsSync(baseCompose)) {
    throw new Error(`catalog has no ${name}/compose.yml at ref ${cfg.ref}`);
  }

  const stateApp = paths.state.app(name);
  const userOverride = fs.existsSync(etcApp.compose) ? etcApp.compose : null;
  const env = await resolveAppEnv(cfg.env);

  return {
    name,
    ref: cfg.ref,
    baseCompose,
    stateCompose: stateApp.compose,
    dataDir: stateApp.data,
    userOverride,
    projectDir: etcApp.root,
    env,
  };
};

export const execute = async (p: AppPlan): Promise<void> => {
  fs.mkdirSync(p.dataDir, { recursive: true });
  fs.copyFileSync(p.baseCompose, p.stateCompose);

  const fileArgs = buildComposeArgs(p.stateCompose, p.userOverride);

  await $`docker compose ${fileArgs} --project-directory ${p.projectDir} -p ${p.name} up -d`
    .env({ ...process.env, ...p.env });

  console.log(`reconciled ${p.name} @ ${p.ref}`);
};

export const reconcile = async (): Promise<void> => {
  const cfg = config.bicycle();
  if (!fs.existsSync(paths.etc.apps)) return;

  for (const name of fs.readdirSync(paths.etc.apps)) {
    if (!fs.statSync(paths.etc.app(name).root).isDirectory()) continue;
    const p = await plan(name, cfg.catalog.url);
    if (p) await execute(p);
  }
};
