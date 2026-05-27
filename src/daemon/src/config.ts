import fs from "fs";
import { paths } from "./paths";

export type BicycleConfig = {
  machine: { hostname: string };
  catalog: { url: string };
  systemd?: { enable?: string[] };
};

export type AppConfig = {
  ref: string;
  env?: Record<string, string>;
};

export const bicycle = (): BicycleConfig =>
  Bun.TOML.parse(fs.readFileSync(paths.etc.bicycleToml, "utf8")) as BicycleConfig;

export const app = (name: string): AppConfig =>
  Bun.YAML.parse(fs.readFileSync(paths.etc.app(name).config, "utf8")) as AppConfig;
