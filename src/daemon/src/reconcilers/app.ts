import { $ } from "bun";
import fs from "fs";
import { paths } from "../paths";
import * as config from "../config";
import * as secrets from "../secrets";
import { ensure as ensureRepo } from "./git";
import * as manifest from "./manifest";
import { chownIgnoreEperm } from "../fs";

export type AppPlan = {
  name: string;
  ref: string;
  baseCompose: string;
  stateRoot: string;
  stateCompose: string;
  stateOverride: string;
  overrideContent: string | null;
  mounts: manifest.Mount[];
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
  const st = fs.statSync(m.hostPath);
  if (st.uid === m.owner.uid && st.gid === m.owner.gid) return;
  chownIgnoreEperm(m.hostPath, m.owner.uid, m.owner.gid);
};

export const plan = async (
  name: string,
  catalogUrl: string,
): Promise<AppPlan | null> => {
  const etcApp = paths.etc.app(name);
  if (!fs.existsSync(etcApp.config)) return null;

  const cfg = config.app(name);
  const cache = paths.state.cache.catalog(name, cfg.ref);

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
  const env = await resolveAppEnv(cfg.env);
  manifest.validateEnv(m.env, env, name);

  const mounts = manifest.planMounts(m, name);
  const overrideContent = manifest.generateOverride(mounts);

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
