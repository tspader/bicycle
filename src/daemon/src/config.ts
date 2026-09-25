import fs from "fs";
import { AppConfig, BicycleConfig, loadBicycleDoc } from "@bicycle/shared";
import { paths } from "./paths";

export type { AppConfig, BicycleConfig };

export const bicycle = (): BicycleConfig =>
  loadBicycleDoc(fs.readFileSync(paths.etc.bicycleYaml, "utf8")).resolved;

export const maybe = (): BicycleConfig | null =>
  fs.existsSync(paths.etc.bicycleYaml) ? bicycle() : null;

export const app = (name: string): AppConfig =>
  AppConfig.parse(Bun.YAML.parse(fs.readFileSync(paths.etc.app(name).config, "utf8")));
