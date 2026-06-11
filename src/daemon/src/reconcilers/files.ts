import crypto from "crypto";
import fs from "fs";
import path from "path";
import { FileDescriptor } from "@bicycle/shared";
import { env } from "../env";
import { paths } from "../paths";
import * as age from "../age";
import * as config from "../config";
import * as nss from "../nss";
import * as secrets from "../secrets";
import * as template from "../template";
import { chownIgnoreEperm } from "../fs";
import { log } from "../logger";

// One deployable unit. `target` is the host path relative to HOST_ROOT (also
// the manifest key). A content file under files/ claims its own suffix-stripped
// path; a `<target>.bicycle` descriptor claims its name minus the suffix.
type FileEntry = {
  kind: "file";
  target: string;
  source: string; // absolute path under /etc/bicycle
  encrypted: boolean;
  template: boolean;
  mode?: number;
  owner?: string;
  group?: string;
};
type SymlinkEntry = {
  kind: "symlink";
  target: string;
  to: string;
  owner?: string;
  group?: string;
};
type Entry = FileEntry | SymlinkEntry;

// `errored` means the plan may be missing entries the repo actually declares
// (parse failure, conflict, unreadable vars). An errored plan still applies
// what it has, but is never authoritative for DELETIONS — pruning a target
// because a typo hid it from the plan would remove live files.
type Plan = { entries: Entry[]; errored: boolean };

const walk = (root: string): string[] => {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile()) out.push(full);
    }
  }
  return out;
};

const sha = (b: Uint8Array): string =>
  crypto.createHash("sha256").update(b).digest("hex");

// Suffixes compose outside-in: `.age` (decrypt) must be outermost, then `.tpl`
// (render). `x.tpl.age` is an encrypted template; `x.age.tpl` would mean
// "render the ciphertext" and is rejected.
const parseSuffixes = (
  rel: string,
): { stripped: string; encrypted: boolean; template: boolean } => {
  let rest = rel;
  let encrypted = false;
  if (rest.endsWith(".age")) {
    encrypted = true;
    rest = rest.slice(0, -".age".length);
  }
  let tpl = false;
  if (rest.endsWith(".tpl")) {
    tpl = true;
    rest = rest.slice(0, -".tpl".length);
  }
  if (tpl && rest.endsWith(".age")) {
    throw new Error(`${rel}: .age.tpl is not supported; use .tpl.age (decrypt, then render)`);
  }
  return { stripped: rest, encrypted, template: tpl };
};

// `from:` resolves under files/ itself, so it can only ever name deployable
// content — age.key, secrets/, bicycle.yml are simply out of reach.
const resolveFrom = (from: string): string => {
  const abs = path.resolve(paths.etc.files, from);
  const rel = path.relative(paths.etc.files, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`from escapes files/: ${from}`);
  }
  if (abs.endsWith(".bicycle")) {
    throw new Error(`from may not reference a descriptor: ${from}`);
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error(`from does not exist: ${from}`);
  }
  return abs;
};

// A descriptor's content defaults to the sibling file at its own name. The
// suffix is interpreted relative to the TARGET name (so a target that itself
// ends in .age/.tpl is still matched verbatim by its exact-name sibling).
const SIBLING_SUFFIXES = [
  { suffix: "", encrypted: false, template: false },
  { suffix: ".tpl", encrypted: false, template: true },
  { suffix: ".age", encrypted: true, template: false },
  { suffix: ".tpl.age", encrypted: true, template: true },
] as const;

const siblingCandidates = (target: string) =>
  SIBLING_SUFFIXES.map((s) => ({
    ...s,
    abs: path.join(paths.etc.files, target + s.suffix),
  }));

const planDescriptor = (
  src: string,
  target: string,
): { entry: Entry; consumed: string | null } => {
  const raw = Bun.YAML.parse(fs.readFileSync(src, "utf8"));
  const d = FileDescriptor.parse(raw);
  if (d.kind === "symlink") {
    return {
      entry: { kind: "symlink", target, to: d.to!, owner: d.owner, group: d.group },
      consumed: null,
    };
  }

  const siblings = siblingCandidates(target).filter(
    (c) => fs.existsSync(c.abs) && fs.statSync(c.abs).isFile(),
  );
  let source: string;
  let encrypted: boolean;
  let template: boolean;
  let consumed: string | null = null;
  if (d.from !== undefined) {
    if (siblings.length > 0) {
      throw new Error(
        `${target}: both from: and sibling content exist (${siblings.map((s) => s.abs).join(", ")})`,
      );
    }
    source = resolveFrom(d.from);
    const suffixes = parseSuffixes(d.from);
    encrypted = suffixes.encrypted;
    template = suffixes.template;
  } else {
    if (siblings.length === 0) {
      throw new Error(`${target}: no from: and no sibling content file`);
    }
    if (siblings.length > 1) {
      throw new Error(
        `${target}: ambiguous sibling content: ${siblings.map((s) => s.abs).join(", ")}`,
      );
    }
    const s = siblings[0]!;
    source = s.abs;
    encrypted = s.encrypted;
    template = s.template;
    consumed = s.abs;
  }

  return {
    entry: {
      kind: "file",
      target,
      source,
      encrypted,
      template: d.template ?? template,
      mode: d.mode !== undefined ? parseInt(d.mode, 8) : undefined,
      owner: d.owner,
      group: d.group,
    },
    consumed,
  };
};

const buildPlan = (): Plan => {
  const srcRoot = paths.etc.files;
  let errored = false;
  const claims = new Map<string, { entry: Entry; src: string }[]>();
  const claim = (entry: Entry, src: string): void => {
    const list = claims.get(entry.target) ?? [];
    list.push({ entry, src });
    claims.set(entry.target, list);
  };

  // Descriptors first: a descriptor that sources its sibling CONSUMES it (the
  // sibling stops self-claiming — that's how a bare `mode:` descriptor adorns
  // its adjacent file without conflicting with it). A descriptor that errors
  // consumes all its candidate siblings too, so the content it was supposed to
  // govern never half-deploys with default attributes.
  const all = walk(srcRoot);
  const consumed = new Set<string>();
  for (const src of all.filter((p) => p.endsWith(".bicycle"))) {
    const target = path.relative(srcRoot, src).slice(0, -".bicycle".length);
    try {
      const planned = planDescriptor(src, target);
      claim(planned.entry, src);
      if (planned.consumed) consumed.add(planned.consumed);
    } catch (e) {
      log.error({ err: e, src }, "files: bad descriptor; skipped");
      errored = true;
      for (const c of siblingCandidates(target)) consumed.add(c.abs);
    }
  }

  for (const src of all.filter((p) => !p.endsWith(".bicycle"))) {
    if (consumed.has(src)) continue;
    const rel = path.relative(srcRoot, src);
    try {
      const { stripped, encrypted, template: tpl } = parseSuffixes(rel);
      claim(
        { kind: "file", target: stripped, source: src, encrypted, template: tpl },
        src,
      );
    } catch (e) {
      log.error({ err: e, src }, "files: bad entry; skipped");
      errored = true;
    }
  }

  const entries: Entry[] = [];
  for (const [target, list] of claims) {
    if (list.length > 1) {
      log.error(
        { target, sources: list.map((c) => c.src) },
        "files: conflicting sources for one target; all skipped",
      );
      errored = true;
      continue;
    }
    entries.push(list[0]!.entry);
  }
  entries.sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
  return { entries, errored };
};

const ensureDir = (target: string): void => {
  if (fs.existsSync(target)) return;
  const parent = path.dirname(target);
  ensureDir(parent);
  const parentStat = fs.statSync(parent);
  fs.mkdirSync(target);
  chownIgnoreEperm(target, parentStat.uid, parentStat.gid);
};

const writeAtomic = (
  dest: string,
  bytes: Uint8Array,
  mode: number,
  own: { uid: number; gid: number } | null,
): void => {
  const parent = path.dirname(dest);
  ensureDir(parent);
  const parentStat = fs.statSync(parent);
  const tmp = `${dest}.bicycle.tmp`;
  fs.writeFileSync(tmp, bytes, { mode });
  try {
    fs.chmodSync(tmp, mode); // exact bits, regardless of umask
    chownIgnoreEperm(tmp, own?.uid ?? parentStat.uid, own?.gid ?? parentStat.gid);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
  fs.renameSync(tmp, dest);
};

const resolveOwnership = async (
  entry: Entry,
): Promise<{ uid: number; gid: number } | null> => {
  if (!entry.owner && !entry.group) return null;
  const uid = entry.owner ? await nss.lookupUid(entry.owner) : null;
  const gid = entry.group ? await nss.lookupGid(entry.group) : null;
  if (entry.owner && uid === null) {
    log.warn({ target: entry.target, owner: entry.owner }, "files: owner unknown; skipping chown");
  }
  if (entry.group && gid === null) {
    log.warn({ target: entry.target, group: entry.group }, "files: group unknown; skipping chgrp");
  }
  if (uid === null && gid === null) return null;
  return { uid: uid ?? -1, gid: gid ?? -1 };
};

// -1 in `want` means "leave as-is" (chown treats -1 as no-change).
const fixOwnership = (dest: string, st: fs.Stats, want: { uid: number; gid: number }): void => {
  const wantUid = want.uid === -1 ? st.uid : want.uid;
  const wantGid = want.gid === -1 ? st.gid : want.gid;
  if (wantUid === st.uid && wantGid === st.gid) return;
  chownIgnoreEperm(dest, wantUid, wantGid);
  log.info({ dest, uid: wantUid, gid: wantGid }, "files: fixed ownership");
};

const loadContent = async (
  entry: FileEntry,
  vars: unknown,
): Promise<{ bytes: Uint8Array; usedSecret: boolean }> => {
  let bytes = entry.encrypted
    ? await age.decrypt(entry.source)
    : new Uint8Array(fs.readFileSync(entry.source));
  let usedSecret = false;
  if (entry.template) {
    // fatal: a non-UTF-8 source marked as a template fails loudly instead of
    // rendering with U+FFFD garbage.
    const r = await template.render(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      vars,
      secrets.resolve,
    );
    bytes = new TextEncoder().encode(r.text);
    usedSecret = r.usedSecret;
  }
  return { bytes, usedSecret };
};

// Destination permission bits, in precedence order: an explicit descriptor
// mode always wins; otherwise anything carrying secret material (.age source,
// or a template that resolved a secret) lands 0600; otherwise the source
// file's mode — the tree controls perms: 0644 for normal configs, 0755 for
// scripts.
const modeFor = (entry: FileEntry, usedSecret: boolean): number => {
  if (entry.mode !== undefined) return entry.mode;
  const srcMode = fs.statSync(entry.source).mode & 0o7777;
  if (entry.encrypted || usedSecret) {
    if (usedSecret && srcMode & 0o111) {
      log.warn(
        { target: entry.target },
        "files: template uses a secret; forcing 0600 and dropping the executable bit (set mode in a .bicycle descriptor to override)",
      );
    }
    return 0o600;
  }
  return srcMode;
};

const applyFile = async (entry: FileEntry, vars: unknown): Promise<void> => {
  const dest = path.join(env.HOST_ROOT, entry.target);
  const { bytes, usedSecret } = await loadContent(entry, vars);
  const mode = modeFor(entry, usedSecret);
  const own = await resolveOwnership(entry);
  // lstat, not stat: a dest that is currently a symlink (e.g. an entry that
  // switched kinds) must fall through to writeAtomic, which renames over the
  // link itself rather than writing through it.
  let destStat: fs.Stats | null = null;
  try { destStat = fs.lstatSync(dest); } catch {}
  if (destStat?.isFile()) {
    const existing = new Uint8Array(fs.readFileSync(dest));
    if (sha(existing) === sha(bytes)) {
      // Content already matches; still reconcile mode and ownership so files
      // chmod'd/chown'd out of band get corrected without a content change.
      if ((destStat.mode & 0o7777) !== mode) {
        fs.chmodSync(dest, mode);
        log.info({ dest, mode: mode.toString(8) }, "files: fixed mode");
      }
      if (own) fixOwnership(dest, destStat, own);
      return;
    }
  }
  writeAtomic(dest, bytes, mode, own && own.uid !== -1 && own.gid !== -1 ? own : null);
  if (own) fixOwnership(dest, fs.lstatSync(dest), own);
  log.info({ src: entry.source, dest }, "files: wrote");
};

const applySymlink = async (entry: SymlinkEntry): Promise<void> => {
  const dest = path.join(env.HOST_ROOT, entry.target);
  const own = await resolveOwnership(entry);
  ensureDir(path.dirname(dest));
  let st: fs.Stats | null = null;
  try { st = fs.lstatSync(dest); } catch {}
  if (st?.isSymbolicLink() && fs.readlinkSync(dest) === entry.to) {
    if (own) {
      const wantUid = own.uid === -1 ? st.uid : own.uid;
      const wantGid = own.gid === -1 ? st.gid : own.gid;
      if (wantUid !== st.uid || wantGid !== st.gid) {
        try { fs.lchownSync(dest, wantUid, wantGid); } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EPERM") throw e;
        }
      }
    }
    return;
  }
  const tmp = `${dest}.bicycle.tmp`;
  fs.rmSync(tmp, { force: true });
  fs.symlinkSync(entry.to, tmp);
  try {
    if (own) {
      try { fs.lchownSync(tmp, own.uid, own.gid); } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EPERM") throw e;
      }
    }
    fs.renameSync(tmp, dest);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
  log.info({ dest, to: entry.to }, "files: linked");
};

const readManifest = (): string[] => {
  const file = paths.state.filesManifest;
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(parsed) && parsed.every((t) => typeof t === "string")) return parsed;
  } catch {}
  log.warn({ file }, "files: unreadable manifest; previously managed targets forgotten");
  return [];
};

const writeManifest = (targets: string[]): void => {
  const file = paths.state.filesManifest;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify([...targets].sort(), null, 2) + "\n");
  fs.renameSync(tmp, file);
};

const removeTarget = (target: string): void => {
  const dest = path.join(env.HOST_ROOT, target);
  let st: fs.Stats;
  try { st = fs.lstatSync(dest); } catch { return; }
  if (st.isDirectory()) {
    log.warn({ dest }, "files: stale target is a directory; not removing");
    return;
  }
  try {
    fs.unlinkSync(dest);
    log.info({ dest }, "files: removed (no longer declared)");
  } catch (e) {
    log.error({ err: e, dest }, "files: remove failed");
  }
};

// Targets bicycle wrote in the past but which the tree no longer declares
// (renames, deletions) get cleaned up. An errored plan never prunes — the
// manifest instead grows by union so nothing is forgotten while the repo is
// broken, and the next clean sweep reconciles it.
const reconcileManifest = (plan: Plan): void => {
  const prev = readManifest();
  const current = new Set(plan.entries.map((e) => e.target));
  if (plan.errored) {
    writeManifest([...new Set([...prev, ...current])]);
    return;
  }
  for (const t of prev) {
    if (!current.has(t)) removeTarget(t);
  }
  writeManifest([...current]);
};

export const all = async (): Promise<void> => {
  const srcRoot = paths.etc.files;
  // A missing files/ root is treated as "nothing to do", NOT as "everything was
  // deleted" — a watcher firing mid-checkout must never trigger a mass prune.
  if (!fs.existsSync(srcRoot)) return;

  const plan = buildPlan();

  let vars: unknown = {};
  if (plan.entries.some((e) => e.kind === "file" && e.template)) {
    try {
      vars = config.bicycle().vars ?? {};
    } catch (e) {
      log.error({ err: e }, "files: cannot load vars; skipping templated entries");
      plan.errored = true;
      plan.entries = plan.entries.filter((e) => !(e.kind === "file" && e.template));
    }
  }

  for (const entry of plan.entries) {
    try {
      if (entry.kind === "file") await applyFile(entry, vars);
      else await applySymlink(entry);
    } catch (e) {
      log.error({ err: e, target: entry.target }, "files: failed");
    }
  }

  reconcileManifest(plan);
};
