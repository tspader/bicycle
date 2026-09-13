import fs from "fs";
import path from "path";
import { paths } from "./paths";
import { log } from "./logger";

export const read = (): string[] => {
  const file = paths.state.filesManifest;
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(parsed) && parsed.every((t) => typeof t === "string")) return parsed;
  } catch {}
  log.warn({ file }, "files: unreadable manifest; previously managed targets forgotten");
  return [];
};

export const write = (targets: string[]): void => {
  const file = paths.state.filesManifest;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify([...targets].sort(), null, 2) + "\n");
  fs.renameSync(tmp, file);
};
