import fs from "fs";
import path from "path";
import * as config from "../config";
import { paths } from "../paths";

export type Claims = {
  exact: string[];
  prefixes: string[];
};

export const gather = (): Claims => {
  const exact = new Set<string>();
  const prefixes = new Set<string>();

  prefixes.add(paths.etc.root);
  prefixes.add(paths.state.root);

  if (fs.existsSync(paths.state.filesManifest)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(paths.state.filesManifest, "utf8"));
      if (Array.isArray(parsed)) {
        for (const t of parsed) {
          if (typeof t === "string") exact.add(path.join("/", t));
        }
      }
    } catch {
    }
  }

  exact.add("/etc/sudoers.d/bicycle");

  if (fs.existsSync(paths.etc.bicycleYaml)) {
    try {
      for (const d of config.bicycle().dirs ?? []) prefixes.add(d.path);
    } catch {
    }
  }

  return { exact: [...exact].sort(), prefixes: [...prefixes].sort() };
};

export const render = (c: Claims): string =>
  [...c.prefixes.map((p) => `P ${p}`), ...c.exact.map((p) => `E ${p}`), ""].join("\n");

export const write = (): string => {
  const file = paths.run.claims;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, render(gather()));
  return file;
};
