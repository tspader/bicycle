import { z } from "zod";
import type { Diff } from "./diff";

declare const Bun: { YAML: { parse: (text: string) => unknown } };

export const IgnoreRule = z
  .object({
    type: z.string().min(1),
    id: z.string().min(1),
    field: z.string().min(1).optional(),
  })
  .strict();
export type IgnoreRule = z.infer<typeof IgnoreRule>;

export const IgnoreConfig = z
  .object({
    files: z.array(z.string().min(1)).default([]),
    packages: z.array(z.string().min(1)).default([]),
    units: z.array(z.string().min(1)).default([]),
    diffs: z.array(IgnoreRule).default([]),
  })
  .strict();
export type IgnoreConfig = z.infer<typeof IgnoreConfig>;

export const empty = (): IgnoreConfig => IgnoreConfig.parse({});

export const parse = (text: string): IgnoreConfig => {
  const raw = Bun.YAML.parse(text) ?? {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("ignore.yml: top level must be an object");
  }
  return IgnoreConfig.parse(raw);
};

export const merge = (...cfgs: IgnoreConfig[]): IgnoreConfig =>
  IgnoreConfig.parse({
    files: cfgs.flatMap((c) => c.files),
    packages: cfgs.flatMap((c) => c.packages),
    units: cfgs.flatMap((c) => c.units),
    diffs: cfgs.flatMap((c) => c.diffs),
  });

const ESCAPE = /[.+^${}()|[\]\\]/;

export const globToRegExp = (pattern: string): RegExp => {
  let norm = pattern.endsWith("/") ? `${pattern}**` : pattern;
  let re = "";
  if (!norm.startsWith("/")) {
    norm = norm.replace(/^\*\*\//, "");
    re += "(?:.*/)?";
  }
  for (let i = 0; i < norm.length; i++) {
    const ch = norm[i]!;
    if (ch === "*") {
      if (norm[i + 1] === "*") {
        if (norm[i + 2] === "/") {
          re += "(?:[^/]+/)*";
          i += 2;
        } else if (i + 2 === norm.length && norm[i - 1] === "/") {
          re = `${re.slice(0, -1)}(?:/.*)?`;
          i += 1;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else {
      re += ESCAPE.test(ch) ? `\\${ch}` : ch;
    }
  }
  return new RegExp(`^${re}$`);
};

const PRUNE = /^(\/[^*?]+?)\/\*\*$/;

export const prunesOf = (files: readonly string[]): string[] => {
  const out = new Set<string>();
  for (const p of files) {
    const m = (p.endsWith("/") ? `${p}**` : p).match(PRUNE);
    if (m) out.add(m[1]!);
  }
  return [...out].sort();
};

const DETECTED_FILE_TYPES = new Set(["stray", "pacman-file"]);

export type IgnoreMatcher = {
  ignores: (d: Diff) => boolean;
  prunes: string[];
  patterns: string[];
};

export const compile = (cfg: IgnoreConfig): IgnoreMatcher => {
  const files = cfg.files.map(globToRegExp);
  const packages = cfg.packages.map(globToRegExp);
  const units = cfg.units.map(globToRegExp);
  const rules = cfg.diffs.map((r) => ({ ...r, idRe: globToRegExp(r.id) }));

  const ignores = (d: Diff): boolean => {
    if (DETECTED_FILE_TYPES.has(d.type) && files.some((re) => re.test(d.id))) {
      return true;
    }
    if (d.type === "package" && d.expected === null && packages.some((re) => re.test(d.id))) {
      return true;
    }
    if (d.type === "unit" && d.expected === null && units.some((re) => re.test(d.id))) {
      return true;
    }
    return rules.some(
      (r) => r.type === d.type && r.idRe.test(d.id) && (!r.field || r.field === d.field),
    );
  };

  return { ignores, prunes: prunesOf(cfg.files), patterns: [...cfg.files] };
};

export const DEFAULTS: IgnoreConfig = IgnoreConfig.parse({
  files: [
    "/dev/**",
    "/proc/**",
    "/sys/**",
    "/run/**",
    "/tmp/**",
    "/home/**",
    "/root/**",
    "/media/**",
    "/mnt/**",
    "/lost+found/**",
    "/var/cache/**",
    "/var/log/**",
    "/var/tmp/**",
    "/var/spool/**",
    "/var/lib/pacman/**",
    "/etc/machine-id",
    "/etc/ssh/ssh_host_*",
    "/etc/ssh/moduli",
    "/etc/pacman.d/gnupg/**",
    "/etc/passwd",
    "/etc/passwd-",
    "/etc/group",
    "/etc/group-",
    "/etc/shadow",
    "/etc/shadow-",
    "/etc/gshadow",
    "/etc/gshadow-",
    "/etc/subuid",
    "/etc/subuid-",
    "/etc/subgid",
    "/etc/subgid-",
    "/etc/ld.so.cache",
    "/etc/.updated",
    "/etc/.pwd.lock",
    "/etc/adjtime",
    "/boot/loader/random-seed",
    "/usr/share/mime/**",
    "/usr/share/applications/mimeinfo.cache",
    "/usr/share/icons/*/icon-theme.cache",
    "/usr/share/info/dir",
    "/usr/share/glib-2.0/schemas/gschemas.compiled",
    "/usr/lib/locale/locale-archive",
    "/usr/lib/udev/hwdb.bin",
    "/usr/lib/gconv/gconv-modules.cache",
    "/usr/lib/gdk-pixbuf-2.0/*/loaders.cache",
    "/usr/lib/gio/modules/giomodule.cache",
    "/usr/lib/gtk-3.0/*/immodules.cache",
    "*.pacnew",
    "*.pacsave",
  ],
});
