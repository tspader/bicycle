import { BicycleConfig } from "./index";
import * as vars from "./vars";

declare const Bun: { YAML: { parse: (text: string) => unknown } };

export type LoadedDoc = {
  /** Raw bicycle.yml text exactly as the user provided it. */
  text: string;
  /** Parsed YAML before vars resolution (vars: still present). */
  raw: Record<string, unknown>;
  /** Vars-resolved, zod-validated config. */
  resolved: BicycleConfig;
};

/**
 * Parse bicycle.yml text, resolve `${var}` references against the doc's own
 * `vars:` table, and validate the result against the BicycleConfig schema.
 *
 * Both the installer and the daemon load configs through here so they can't
 * drift on either step.
 */
export const loadBicycleDoc = (text: string): LoadedDoc => {
  const raw = Bun.YAML.parse(text);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("bicycle.yml: top level must be an object");
  }
  const rawObj = raw as Record<string, unknown>;
  const resolvedVars = vars.validateTable(rawObj.vars);
  const { vars: _omit, ...rest } = rawObj;
  const resolved = vars.walk(rest, resolvedVars) as Record<string, unknown>;
  return {
    text,
    raw: rawObj,
    resolved: BicycleConfig.parse({ vars: resolvedVars, ...resolved }),
  };
};
