import path from "path";
import { env } from "./env";

export const paths = {
  get etc() {
    const etc = env.ETC;
    const secrets = path.join(etc, "secrets");
    return {
      root: etc,
      bicycleToml: path.join(etc, "bicycle.toml"),
      ageKey: path.join(etc, "age.key"),
      recipients: path.join(etc, "recipients"),
      files: path.join(etc, "files"),
      secrets,
      secret: (addr: string) => path.join(secrets, `${addr}.age`),
      apps: path.join(etc, "apps"),
      app: (name: string) => ({
        root: path.join(etc, "apps", name),
        config: path.join(etc, "apps", name, "config.yml"),
        compose: path.join(etc, "apps", name, "compose.yml"),
      }),
    };
  },
  get run() {
    const run = env.RUN;
    return {
      root: run,
      reconcileLock: path.join(run, "reconcile.lock"),
    };
  },
  get state() {
    const state = env.VAR;
    return {
      root: state,
      cache: {
        catalog: (app: string, ref: string) =>
          path.join(state, "cache", "catalog", app, ref),
      },
      apps: path.join(state, "apps"),
      app: (name: string) => ({
        root: path.join(state, "apps", name),
        compose: path.join(state, "apps", name, "compose.yml"),
        data: path.join(state, "apps", name, "data"),
      }),
    };
  },
};
