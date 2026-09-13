import { z } from "zod";
import type { Diff } from "./diff";

declare const Bun: {
  YAML: { parse: (text: string) => unknown };
  Glob: new (pattern: string) => { match: (path: string) => boolean };
};

const GLOB_CHARS = /[*?[\]{}]/;

export const isGlob = (s: string): boolean => GLOB_CHARS.test(s);

const FilePattern = z
  .string()
  .min(1)
  .refine((p) => p.startsWith("/") || p.startsWith("**/"), {
    message: 'file pattern must start with "/" or "**/"',
  });

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
    files: z.array(FilePattern).default([]),
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

const stripSlash = (p: string): string =>
  p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;

export const prunesOf = (files: readonly string[]): string[] => {
  const out = new Set<string>();
  for (const p of files) {
    const norm = stripSlash(p);
    if (!isGlob(norm) && norm.startsWith("/")) out.add(norm);
  }
  return [...out].sort();
};

type Match = (id: string) => boolean;

const subtree = (prefix: string): Match => (id) =>
  id === prefix || id.startsWith(`${prefix}/`);

const exact = (value: string): Match => (id) => id === value;

const glob = (pattern: string): Match => {
  const g = new Bun.Glob(pattern);
  return (id) => g.match(id);
};

const anyOf = (matchers: Match[]): Match => (id) => matchers.some((m) => m(id));

const fileMatcher = (patterns: readonly string[]): Match =>
  anyOf(patterns.map((p) => (isGlob(p) ? glob(p) : subtree(stripSlash(p)))));

const nameMatcher = (patterns: readonly string[]): Match =>
  anyOf(patterns.map((p) => (isGlob(p) ? glob(p) : exact(p))));

const DETECTED_FILE_TYPES = new Set(["stray", "pacman-file"]);

export type IgnoreMatcher = {
  ignores: (d: Diff) => boolean;
  prunes: string[];
};

export const compile = (cfg: IgnoreConfig): IgnoreMatcher => {
  const files = fileMatcher(cfg.files);
  const packages = nameMatcher(cfg.packages);
  const units = nameMatcher(cfg.units);
  const rules = cfg.diffs.map((r) => ({
    ...r,
    matches: isGlob(r.id) ? glob(r.id) : exact(r.id),
  }));

  const ignores = (d: Diff): boolean => {
    if (DETECTED_FILE_TYPES.has(d.type) && files(d.id)) return true;
    if (d.type === "package" && d.expected === null && packages(d.id)) return true;
    if (d.type === "unit" && d.expected === null && units(d.id)) return true;
    return rules.some(
      (r) => r.type === d.type && r.matches(d.id) && (!r.field || r.field === d.field),
    );
  };

  return { ignores, prunes: prunesOf(cfg.files) };
};

export const DEFAULTS: IgnoreConfig = IgnoreConfig.parse({
  files: [
    "/dev",
    "/proc",
    "/sys",
    "/run",
    "/tmp",
    "/home",
    "/root",
    "/media",
    "/mnt",
    "/lost+found",
    "/var",
    "/etc/machine-id",
    "/etc/ssh/ssh_host_*",
    "/etc/ssh/moduli",
    "/etc/pacman.d/gnupg",
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
    "/usr/share/mime",
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
    "**/*.pacnew",
    "**/*.pacsave",
  ],
});
