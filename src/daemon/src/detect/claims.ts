import fs from "fs";
import path from "path";
import { paths } from "../paths";

export type Claims = {
  exact: string[];
  prefixes: string[];
};

export const render = (c: Claims): string =>
  [...c.prefixes.map((p) => `P ${p}`), ...c.exact.map((p) => `E ${p}`), ""].join("\n");

export const write = (c: Claims): string => {
  const file = paths.run.claims;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, render(c));
  return file;
};
