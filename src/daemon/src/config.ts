import fs from "fs";
import { BicycleConfig } from "@bicycle/shared";
import { paths } from "./paths";

export type { BicycleConfig };

export type AppConfig = {
  ref: string;
  env?: Record<string, string>;
};

export const bicycle = (): BicycleConfig => {
  const raw = Bun.YAML.parse(fs.readFileSync(paths.etc.bicycleYaml, "utf8"));
  return BicycleConfig.parse(raw);
};

export const app = (name: string): AppConfig =>
  Bun.YAML.parse(fs.readFileSync(paths.etc.app(name).config, "utf8")) as AppConfig;
