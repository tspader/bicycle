import { Liquid } from "liquidjs";

export type RenderResult = { text: string; usedSecret: boolean };

// Filters carried over from dottpl, so existing theme templates work verbatim.
const hexToRgb = (v: unknown): [number, number, number] => {
  const h = String(v).replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`not a hex color: ${String(v)}`);
  const at = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [at(0), at(2), at(4)];
};

// Render a Liquid template against the bicycle.yml vars table. Strict: an
// undefined variable or filter fails the render rather than emitting an empty
// string. Secrets are reached with `{{ "addr/under/secrets" | secret }}`;
// whether any secret was touched is reported back so the caller can default
// the destination mode to 0600 (same rule as whole-file .age sources).
export const render = async (
  source: string,
  vars: unknown,
  resolveSecret: (addr: string) => Promise<string>,
): Promise<RenderResult> => {
  const engine = new Liquid({ strictVariables: true, strictFilters: true });
  let usedSecret = false;
  engine.registerFilter("secret", (addr: unknown) => {
    usedSecret = true;
    return resolveSecret(String(addr));
  });
  engine.registerFilter("strip", (v: unknown) => String(v).replace(/^#/, ""));
  engine.registerFilter("rgb", (v: unknown) => hexToRgb(v).join(" "));
  engine.registerFilter("rgb_comma", (v: unknown) => hexToRgb(v).join(","));
  const text = await engine.parseAndRender(source, (vars as object) ?? {});
  return { text, usedSecret };
};
