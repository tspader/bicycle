import fs from "fs";
import path from "path";
import { writeAtomic } from "./fs";
import { paths } from "./paths";

export type Store = Record<string, number>;

export const RANGE = { first: 20000, last: 20999 };

export const read = (): Store => {
  const file = paths.state.ports;
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

export const write = (store: Store): void => {
  const file = paths.state.ports;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sorted = Object.fromEntries(Object.keys(store).sort().map((k) => [k, store[k]]));
  writeAtomic(file, JSON.stringify(sorted, null, 2) + "\n");
};

export const allocate = (store: Store, name: string): number => {
  if (name in store) return store[name]!;
  const used = new Set(Object.values(store));
  for (let port = RANGE.first; port <= RANGE.last; port++) {
    if (used.has(port)) continue;
    store[name] = port;
    return port;
  }
  throw new Error(`ports: range ${RANGE.first}-${RANGE.last} exhausted`);
};

export const release = (store: Store, name: string): void => {
  delete store[name];
};
