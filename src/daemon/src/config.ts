import fs from "fs";
import { BicycleConfig } from "@bicycle/shared";
import { paths } from "./paths";
import * as vars from "./vars";

export type { BicycleConfig };

export type AppConfig = {
  ref: string;
  env?: Record<string, string>;
};

export const bicycle = (): BicycleConfig => {
  const raw = Bun.YAML.parse(fs.readFileSync(paths.etc.bicycleYaml, "utf8")) as
    | Record<string, unknown>
    | null;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("bicycle.yml: top level must be an object");
  }
  const resolvedVars = vars.validateTable(raw.vars);
  const { vars: _omit, ...rest } = raw;
  const resolved = vars.walk(rest, resolvedVars) as Record<string, unknown>;
  return BicycleConfig.parse({ vars: resolvedVars, ...resolved });
};

export const app = (name: string): AppConfig =>
  Bun.YAML.parse(fs.readFileSync(paths.etc.app(name).config, "utf8")) as AppConfig;
