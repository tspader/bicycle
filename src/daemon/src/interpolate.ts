import * as secrets from "./secrets";
import { get } from "./vars";

const REF = /\$\{([^}]+)\}/g;
const VAR_PATH = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;
const SECRET_PREFIX = "secret:";

const resolveOne = async (inner: string, vars: unknown): Promise<string> => {
  if (inner.startsWith(SECRET_PREFIX)) {
    return secrets.resolve(inner.slice(SECRET_PREFIX.length));
  }
  if (!VAR_PATH.test(inner)) {
    throw new Error(`invalid interpolation \${${inner}}`);
  }
  const val = get(vars, inner);
  if (val === undefined) throw new Error(`unresolved \${${inner}}`);
  if (typeof val === "object" && val !== null) {
    throw new Error(`cannot substitute object value \${${inner}}`);
  }
  return String(val);
};

export const interpolate = async (s: string, vars: unknown): Promise<string> => {
  const matches = [...s.matchAll(REF)];
  if (matches.length === 0) return s;
  const values = await Promise.all(matches.map((m) => resolveOne(m[1]!, vars)));
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
