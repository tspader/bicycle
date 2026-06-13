import { defaultTheme as t, type Command } from "@spader/zargs";
import fs from "fs";
import * as p from "@clack/prompts";
import { ignore, type Diff } from "@bicycle/shared";
import * as kinds from "../kinds";
import { ago, fmt } from "../kinds/render";
import * as ignorefile from "../ignorefile";
import { paths } from "../paths";

const label = (d: Diff): string => {
  const value =
    d.expected === null
      ? fmt(d.actual)
      : d.actual === null
        ? fmt(d.expected)
        : `${fmt(d.actual)} -> ${fmt(d.expected)}`;
  return `${t.arg(d.id)} ${t.dim(`${d.field}:`)} ${value}`;
};

const describe = (e: ignorefile.Entry): string =>
  e.section === "diffs"
    ? `diffs ${e.value.type} ${e.value.id}${e.value.field ? ` ${e.value.field}` : ""}`
    : `${e.section} ${e.value}`;

const aborted = (): void => {
  p.cancel("aborted");
  process.exitCode = 1;
};

const addCmd: Command = {
  description:
    "Interactively pick current diffs and append ignore entries to <etc>/ignore.yml. " +
    "For hand-written rules (globs, custom kinds) edit the file directly.",
  summary: "Pick diffs to ignore",
  handler: async () => {
    p.intro("bicycle ignore add");
    const planned = kinds.plan();

    const kind = await p.select({
      message: "Ignore diffs of which kind?",
      options: kinds.names().map((n) => ({ value: n })),
    });
    if (p.isCancel(kind)) return aborted();

    const s = p.spinner();
    s.start("collecting diffs");
    const result = await planned;
    const entry = result.kinds.find((e) => e.kind === kind);
    const diffs = entry?.diffs ?? [];
    s.stop(`${diffs.length} ${kind} diff(s)`);
    if (entry?.scannedAt === null) {
      p.log.warn(`${kind} has never been scanned — run \`bicycle scan --only ${kind}\``);
    } else if (entry?.scannedAt !== undefined) {
      p.log.info(`from the scan of ${ago(entry.scannedAt)}`);
    }
    if (diffs.length === 0) {
      p.outro(`nothing to ignore for ${kind}`);
      return;
    }

    const picked = await p.autocompleteMultiselect({
      message: "Select diffs to ignore",
      options: diffs.map((d) => ({ value: d, label: label(d) })),
      required: false,
    });
    if (p.isCancel(picked)) return aborted();
    if (picked.length === 0) {
      p.outro("nothing selected");
      return;
    }

    const entries = picked.map(ignorefile.entryFor);
    p.note(entries.map(describe).join("\n"), "new entries");
    const ok = await p.confirm({ message: `Append to ${paths.etc.ignoreYaml}?` });
    if (p.isCancel(ok) || !ok) return aborted();

    let added = 0;
    for (const e of entries) if (ignorefile.add(e)) added++;
    p.outro(
      added === 0
        ? `all entries already present — ${paths.etc.ignoreYaml} unchanged`
        : `wrote ${paths.etc.ignoreYaml}`,
    );
  },
};

export const formatEntries = (cfg: ignore.IgnoreConfig): string[] => [
  ...cfg.files.map((v) => `files ${v}`),
  ...cfg.packages.map((v) => `packages ${v}`),
  ...cfg.units.map((v) => `units ${v}`),
  ...cfg.diffs.map((r) => `diffs ${r.type} ${r.id}${r.field ? ` ${r.field}` : ""}`),
];

const lsCmd: Command = {
  description: "List the entries in <etc>/ignore.yml, one per line",
  summary: "List ignore entries",
  options: {
    builtin: { type: "boolean", description: "show the shipped baseline instead of the user's file" },
  },
  handler: (argv) => {
    const cfg = argv.builtin ? ignore.DEFAULTS : ignorefile.read().cfg;
    for (const line of formatEntries(cfg)) process.stdout.write(line + "\n");
  },
};

const tokenize = (line: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let has = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === " " || ch === "\t") {
      if (has) { out.push(cur); cur = ""; has = false; }
      i++;
    } else if (ch === "'") {
      has = true;
      i++;
      while (i < line.length && line[i] !== "'") { cur += line[i]; i++; }
      i++;
    } else if (ch === '"') {
      has = true;
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\" && i + 1 < line.length) { cur += line[i + 1]; i += 2; }
        else { cur += line[i]; i++; }
      }
      i++;
    } else if (ch === "\\" && i + 1 < line.length) {
      has = true;
      cur += line[i + 1];
      i += 2;
    } else {
      has = true;
      cur += ch;
      i++;
    }
  }
  if (has) out.push(cur);
  return out;
};

const translatePath = (pat: string): { pattern: string; warning?: string } => {
  let out = pat;
  if (out.endsWith("*") && !out.endsWith("**")) out += "*";
  let inner = out.startsWith("*") ? out.slice(1) : out;
  if (inner.endsWith("**")) inner = inner.slice(0, -2);
  if (inner.includes("*")) {
    return {
      pattern: out,
      warning: `${pat}: interior "*" no longer crosses "/" — review the imported pattern`,
    };
  }
  return { pattern: out };
};

const unescape = (s: string): string => s.replace(/\\(.)/g, "$1");

export type ParseResult = { entries: ignorefile.Entry[]; warnings: string[] };

export const parseAconfmgr = (text: string): ParseResult => {
  const entries: ignorefile.Entry[] = [];
  const warnings: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const tokens = tokenize(line);
    const [directive, ...rest] = tokens;
    const args = rest.filter((t) => !t.startsWith("--"));
    switch (directive) {
      case "IgnorePath": {
        if (args.length === 0) { warnings.push(`${line}: missing pattern`); break; }
        const { pattern, warning } = translatePath(unescape(args[0]!));
        if (warning) warnings.push(warning);
        entries.push({ section: "files", value: pattern });
        break;
      }
      case "IgnoreFile": {
        if (args.length === 0) { warnings.push(`${line}: missing path`); break; }
        entries.push({ section: "files", value: unescape(args[0]!) });
        break;
      }
      case "IgnorePackage": {
        if (args.length === 0) { warnings.push(`${line}: missing package name`); break; }
        entries.push({ section: "packages", value: args[0]! });
        break;
      }
      default:
        warnings.push(`${line}: unknown directive, skipped`);
    }
  }
  return { entries, warnings };
};

const isGlob = (s: string): boolean => /[*?]/.test(s);

export const coveredByDefaults = (() => {
  let matcher: ignore.IgnoreMatcher | null = null;
  return (e: ignorefile.Entry): boolean => {
    if (e.section === "diffs") return false;
    if (ignore.DEFAULTS[e.section].includes(e.value)) return true;
    if (isGlob(e.value)) return false;
    matcher ??= ignore.compile(ignore.DEFAULTS);
    const probe = { field: "exists", expected: null, actual: null };
    if (e.section === "files") {
      return matcher.ignores({ type: "stray", id: e.value, ...probe });
    }
    if (e.section === "packages") {
      return matcher.ignores({ type: "package", id: e.value, ...probe });
    }
    return matcher.ignores({ type: "unit", id: e.value, ...probe });
  };
})();

export type ImportSummary = {
  imported: number;
  present: number;
  skipped: number;
  warnings: string[];
};

export const runImport = (text: string): ImportSummary => {
  const { entries, warnings } = parseAconfmgr(text);
  let imported = 0;
  let present = 0;
  let skipped = 0;
  for (const e of entries) {
    if (coveredByDefaults(e)) { skipped++; continue; }
    if (ignorefile.add(e)) imported++;
    else present++;
  }
  return { imported, present, skipped, warnings };
};

const importCmd: Command = {
  description: "Translate an aconfmgr ignore script into <etc>/ignore.yml entries",
  summary: "Import aconfmgr IgnorePath/IgnorePackage/IgnoreFile lines",
  positionals: {
    script: { type: "string", description: "path to the aconfmgr ignore script", required: true },
  },
  handler: (argv) => {
    const text = fs.readFileSync(String(argv.script), "utf8");
    const s = runImport(text);
    for (const w of s.warnings) process.stderr.write(`warning: ${w}\n`);
    process.stdout.write(
      `${s.imported} imported, ${s.present} already present, ${s.skipped} skipped (builtin)\n`,
    );
  },
};

export const command: Command = {
  description: "Manage <etc>/ignore.yml",
  summary: "Add / list / import ignore entries",
  commands: { add: addCmd, ls: lsCmd, import: importCmd },
};
