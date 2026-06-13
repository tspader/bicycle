import fs from "fs";
import { ignore, yamledit, type Diff } from "@bicycle/shared";
import { paths } from "./paths";

export type Entry =
  | { section: "files" | "packages" | "units"; value: string }
  | { section: "diffs"; value: ignore.IgnoreRule };

export const entryFor = (d: Diff): Entry => {
  if (d.type === "stray" || d.type === "pacman-file") {
    return { section: "files", value: d.id };
  }
  if (d.type === "package" && d.expected === null) {
    return { section: "packages", value: d.id };
  }
  if (d.type === "unit" && d.expected === null) {
    return { section: "units", value: d.id };
  }
  return { section: "diffs", value: { type: d.type, id: d.id, field: d.field } };
};

export const read = (): { text: string; cfg: ignore.IgnoreConfig } => {
  const p = paths.etc.ignoreYaml;
  const text = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  return { text, cfg: ignore.parse(text) };
};

export const effective = (): ignore.IgnoreConfig => ignore.merge(ignore.DEFAULTS, read().cfg);

const has = (cfg: ignore.IgnoreConfig, e: Entry): boolean => {
  if (e.section === "diffs") {
    return cfg.diffs.some(
      (r) =>
        r.type === e.value.type &&
        r.id === e.value.id &&
        (r.field ?? null) === (e.value.field ?? null),
    );
  }
  return cfg[e.section].includes(e.value);
};

export const add = (e: Entry): boolean => {
  const { text, cfg } = read();
  if (has(cfg, e)) return false;
  const next =
    e.section === "diffs"
      ? yamledit.append(text, ["diffs"], e.value, "flow")
      : yamledit.append(text, [e.section], e.value, "block");
  fs.writeFileSync(paths.etc.ignoreYaml, next);
  return true;
};

export const addForDiff = (d: Diff): boolean => add(entryFor(d));
