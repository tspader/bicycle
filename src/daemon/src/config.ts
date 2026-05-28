import fs from "fs";
import { BicycleConfig, loadBicycleDoc } from "@bicycle/shared";
import { paths } from "./paths";

export type { BicycleConfig };

export type AppConfig = {
  ref: string;
  env?: Record<string, string>;
};

export const bicycle = (): BicycleConfig =>
  loadBicycleDoc(fs.readFileSync(paths.etc.bicycleYaml, "utf8")).resolved;

export const app = (name: string): AppConfig =>
  Bun.YAML.parse(fs.readFileSync(paths.etc.app(name).config, "utf8")) as AppConfig;
