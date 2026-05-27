const IDENT_PATH_SRC = "[a-zA-Z_][a-zA-Z0-9_]*(?:\\.[a-zA-Z_][a-zA-Z0-9_]*)*";
const WHOLE = new RegExp(`^\\$\\{(${IDENT_PATH_SRC})\\}$`);
const REF = new RegExp(`\\$\\{(${IDENT_PATH_SRC})\\}`, "g");
const ANY_REF = /\$\{[^}]+\}/;

export const get = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>(
    (o, k) => (o == null || typeof o !== "object" ? undefined : (o as Record<string, unknown>)[k]),
    obj,
  );

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const substituteLeaf = (leaf: unknown, vars: unknown, trail: string): unknown => {
  if (typeof leaf !== "string") return leaf;

  const whole = leaf.match(WHOLE);
  if (whole) {
    const path = whole[1]!;
    const val = get(vars, path);
    if (val === undefined) throw new Error(`unresolved \${${path}} at ${trail}`);
    if (isObject(val)) {
      throw new Error(`cannot substitute object value \${${path}} at ${trail}`);
    }
    return val;
  }

  return leaf.replace(REF, (_, path: string) => {
    const val = get(vars, path);
    if (val === undefined) throw new Error(`unresolved \${${path}} at ${trail}`);
    if (isObject(val)) {
      throw new Error(`cannot substitute object value \${${path}} at ${trail}`);
    }
    return String(val);
  });
};

export const walk = (node: unknown, vars: unknown, trail = ""): unknown => {
  if (node === null || typeof node !== "object") {
    return substituteLeaf(node, vars, trail || "(root)");
  }
  if (Array.isArray(node)) {
    return node.map((v, i) => walk(v, vars, `${trail}[${i}]`));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = walk(v, vars, trail ? `${trail}.${k}` : k);
  }
  return out;
};

const assertNoRefs = (node: unknown, trail: string): void => {
  if (typeof node === "string") {
    if (ANY_REF.test(node)) {
      throw new Error(`vars: ${trail} contains \${...} reference; vars cannot reference other vars`);
    }
    return;
  }
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => assertNoRefs(v, `${trail}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    assertNoRefs(v, trail ? `${trail}.${k}` : k);
  }
};

export const validateTable = (rawVars: unknown): Record<string, unknown> => {
  if (rawVars === undefined) return {};
  if (!isObject(rawVars)) throw new Error("vars: must be an object");
  assertNoRefs(rawVars, "vars");
  return rawVars;
};
