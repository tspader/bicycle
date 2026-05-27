import { paths } from "./paths";
import * as age from "./age";

const TOKEN = /\$\{secret:([^}]+)\}/g;

export const resolve = async (addr: string): Promise<string> =>
  age.decryptText(paths.etc.secret(addr));

export const interpolate = async (s: string): Promise<string> => {
  const matches = [...s.matchAll(TOKEN)];
  if (matches.length === 0) return s;
  const values = await Promise.all(matches.map((m) => resolve(m[1]!)));
  let out = "";
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    out += s.slice(cursor, m.index);
    out += values[i]!;
    cursor = m.index + m[0].length;
  }
  out += s.slice(cursor);
  return out;
};
