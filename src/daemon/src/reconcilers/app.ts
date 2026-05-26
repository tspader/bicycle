import { $ } from "bun";
import fs from "fs";
import { paths } from "../paths";
import * as config from "../config";
import * as secrets from "../secrets";
import { ensure as ensureRepo } from "./git";

const reconcileApp = async (name: string, catalogUrl: string) => {
  const etcApp = paths.etc.app(name);
  if (!fs.existsSync(etcApp.config)) return;

  const cfg = config.app(name);
  const cacheDir = paths.state.cache.catalog(name, cfg.ref);

  await ensureRepo({
    repo: catalogUrl,
    ref: cfg.ref,
    dest: cacheDir,
    sparse: [name],
  });

  const baseCompose = `${cacheDir}/${name}/compose.yml`;
  if (!fs.existsSync(baseCompose)) {
    throw new Error(`catalog has no ${name}/compose.yml at ref ${cfg.ref}`);
  }

  const stateApp = paths.state.app(name);
  fs.mkdirSync(stateApp.data, { recursive: true });
  fs.copyFileSync(baseCompose, stateApp.compose);

  const fileArgs = ["-f", stateApp.compose];
  if (fs.existsSync(etcApp.compose)) fileArgs.push("-f", etcApp.compose);

  const appEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg.env ?? {})) {
    appEnv[k] = await secrets.interpolate(v);
  }
  const env = { ...process.env, ...appEnv };

  await $`docker compose ${fileArgs} --project-directory ${etcApp.root} -p ${name} up -d`
    .env(env);

  console.log(`reconciled ${name} @ ${cfg.ref}`);
};

export const reconcile = async (): Promise<void> => {
  const cfg = config.bicycle();

  if (!fs.existsSync(paths.etc.apps)) return;

  for (const name of fs.readdirSync(paths.etc.apps)) {
    if (!fs.statSync(paths.etc.app(name).root).isDirectory()) continue;
    await reconcileApp(name, cfg.catalog.url);
  }
};
