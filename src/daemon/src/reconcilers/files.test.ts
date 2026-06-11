import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { generateIdentity, identityToRecipient } from "age-encryption";
import * as age from "../age";
import * as files from "./files";

let tmp: string;
let etc: string;
let host: string;
let recipient: string;
let saved: Record<string, string | undefined> = {};

const set = (k: string, v: string) => {
  saved[k] = process.env[k];
  process.env[k] = v;
};

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-files-"));
  etc = path.join(tmp, "etc");
  host = path.join(tmp, "host");
  fs.mkdirSync(path.join(etc, "files"), { recursive: true });
  fs.mkdirSync(host, { recursive: true });

  const identity = await generateIdentity();
  recipient = await identityToRecipient(identity);
  const keyPath = path.join(tmp, "age.key");
  fs.writeFileSync(keyPath, identity);

  set("BICYCLE_ETC", etc);
  set("BICYCLE_HOST_ROOT", host);
  set("BICYCLE_VAR", path.join(tmp, "var"));
  set("AGE_KEY", keyPath);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved = {};
});

const stage = (rel: string, contents: string | Uint8Array) => {
  const p = path.join(etc, "files", rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contents);
};

const stageAge = async (rel: string, plaintext: string) => {
  const ciphertext = await age.encrypt(new TextEncoder().encode(plaintext), [recipient]);
  stage(rel, ciphertext);
};

test("mirrors plaintext file into host root with the source's mode", async () => {
  stage("etc/foo.conf", "hello");
  fs.chmodSync(path.join(etc, "files", "etc/foo.conf"), 0o644);
  await files.all();
  const dest = path.join(host, "etc/foo.conf");
  expect(fs.readFileSync(dest, "utf8")).toBe("hello");
  expect(fs.statSync(dest).mode & 0o777).toBe(0o644);
});

test("preserves the executable bit from the source", async () => {
  stage("usr/local/bin/hook", "#!/bin/sh\necho hi\n");
  fs.chmodSync(path.join(etc, "files", "usr/local/bin/hook"), 0o755);
  await files.all();
  expect(fs.statSync(path.join(host, "usr/local/bin/hook")).mode & 0o777).toBe(0o755);
});

test("decrypts .age files, strips suffix, and forces 0600", async () => {
  await stageAge("etc/secret.conf.age", "decrypted");
  // The .age source is 0644 (as git stores it) — the secret must still land 0600.
  fs.chmodSync(path.join(etc, "files", "etc/secret.conf.age"), 0o644);
  await files.all();
  const dest = path.join(host, "etc/secret.conf");
  expect(fs.existsSync(`${dest}.age`)).toBe(false);
  expect(fs.readFileSync(dest, "utf8")).toBe("decrypted");
  expect(fs.statSync(dest).mode & 0o777).toBe(0o600);
});

test("fixes a stale mode even when content is unchanged", async () => {
  stage("etc/foo.conf", "hello");
  fs.chmodSync(path.join(etc, "files", "etc/foo.conf"), 0o644);
  await files.all();
  const dest = path.join(host, "etc/foo.conf");
  // Simulate a file written under the old hardcoded-0600 behaviour.
  fs.chmodSync(dest, 0o600);
  await files.all();
  expect(fs.statSync(dest).mode & 0o777).toBe(0o644);
});

test("creates nested parent directories", async () => {
  stage("a/b/c/d.txt", "deep");
  await files.all();
  expect(fs.readFileSync(path.join(host, "a/b/c/d.txt"), "utf8")).toBe("deep");
});

test("idempotent: second pass does not rewrite unchanged files", async () => {
  stage("foo", "same");
  await files.all();
  const dest = path.join(host, "foo");
  const before = fs.statSync(dest);
  // Backdate so a rewrite would be detectable as mtime increase.
  const old = new Date(before.mtimeMs - 60_000);
  fs.utimesSync(dest, old, old);
  const stamp = fs.statSync(dest).mtimeMs;
  await files.all();
  expect(fs.statSync(dest).mtimeMs).toBe(stamp);
});

test("rewrites when source content changes", async () => {
  stage("foo", "v1");
  await files.all();
  const dest = path.join(host, "foo");
  expect(fs.readFileSync(dest, "utf8")).toBe("v1");
  stage("foo", "v2");
  await files.all();
  expect(fs.readFileSync(dest, "utf8")).toBe("v2");
});

test("continues past a bad .age file", async () => {
  stage("etc/bad.age", "not-actually-age-encrypted");
  stage("etc/good", "ok");
  await files.all();
  expect(fs.existsSync(path.join(host, "etc/bad"))).toBe(false);
  expect(fs.readFileSync(path.join(host, "etc/good"), "utf8")).toBe("ok");
});

test("no-op when source root does not exist", async () => {
  fs.rmSync(path.join(etc, "files"), { recursive: true });
  await files.all();
});

// --- declarative suite: templates, descriptors, fan-out, pruning ------------
//
// A case is pure data: an ordered list of actions (staging the etc tree,
// host-side mutations, sweeps) and a list of expectations against the host
// root. All imperative logic lives in runFilesCase.

type FilesAction =
  | { do: "file"; rel: string; contents: string; mode?: number } // under etc/files
  | { do: "age"; rel: string; plaintext: string } // age-encrypted, under etc/files
  | { do: "secret"; addr: string; clear: string } // under etc/secrets
  | { do: "yml"; text: string } // bicycle.yml
  | { do: "host"; rel: string; contents: string } // pre-existing host file
  | { do: "rm"; rel: string } // remove from etc tree (files/...)
  | { do: "sweep" };

type FilesCheck = {
  path: string; // host-root relative
  contents?: string;
  mode?: number;
  linkTo?: string;
  absent?: boolean;
};

type FilesCase = {
  name: string;
  actions: FilesAction[];
  expect: FilesCheck[];
};

const writeEtc = (rel: string, contents: string | Uint8Array, mode?: number) => {
  const p = path.join(etc, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contents);
  if (mode !== undefined) fs.chmodSync(p, mode);
};

const encryptTo = async (rel: string, plaintext: string) => {
  const ciphertext = await age.encrypt(new TextEncoder().encode(plaintext), [recipient]);
  writeEtc(rel, ciphertext);
};

const runFilesCase = async (c: FilesCase): Promise<void> => {
  for (const a of c.actions) {
    switch (a.do) {
      case "file": writeEtc(path.join("files", a.rel), a.contents, a.mode ?? 0o644); break;
      case "age": await encryptTo(path.join("files", a.rel), a.plaintext); break;
      case "secret": await encryptTo(path.join("secrets", `${a.addr}.age`), a.clear); break;
      case "yml": writeEtc("bicycle.yml", a.text); break;
      case "host": {
        const p = path.join(host, a.rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, a.contents);
        break;
      }
      case "rm": fs.rmSync(path.join(etc, "files", a.rel)); break;
      case "sweep": await files.all(); break;
    }
  }

  for (const check of c.expect) {
    const dest = path.join(host, check.path);
    let st: fs.Stats | null = null;
    try { st = fs.lstatSync(dest); } catch {}
    if (check.absent) {
      expect(st).toBeNull();
      continue;
    }
    expect(st).not.toBeNull();
    if (check.linkTo !== undefined) {
      expect(st!.isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(dest)).toBe(check.linkTo);
    }
    if (check.contents !== undefined) {
      expect(fs.readFileSync(dest, "utf8")).toBe(check.contents);
    }
    if (check.mode !== undefined) {
      expect(st!.mode & 0o7777).toBe(check.mode);
    }
  }
};

const THEME_YML = `vars:
  theme:
    background: "#1F1F1F"
  banner:
    greeting: hello
  hosts: [alpha, beta]
`;

const FILES_CASES: FilesCase[] = [
  {
    name: "renders a .tpl against bicycle.yml vars and strips the suffix",
    actions: [
      { do: "yml", text: THEME_YML },
      { do: "file", rel: "etc/motd.tpl", contents: "greeting: {{ banner.greeting }}\n" },
      { do: "sweep" },
    ],
    expect: [
      { path: "etc/motd", contents: "greeting: hello\n", mode: 0o644 },
      { path: "etc/motd.tpl", absent: true },
    ],
  },
  {
    name: "renders filters and for loops",
    actions: [
      { do: "yml", text: THEME_YML },
      { do: "file", rel: "etc/app.conf.tpl", contents: "bg={{ theme.background | strip }};{% for h in hosts %}{{ h }};{% endfor %}" },
      { do: "sweep" },
    ],
    expect: [{ path: "etc/app.conf", contents: "bg=1F1F1F;alpha;beta;" }],
  },
  {
    name: "template that resolves a secret defaults to 0600",
    actions: [
      { do: "yml", text: THEME_YML },
      { do: "secret", addr: "svc/db", clear: "hunter2" },
      { do: "file", rel: "etc/svc.env.tpl", contents: 'DB_PASSWORD={{ "svc/db" | secret }}\n' },
      { do: "sweep" },
    ],
    expect: [{ path: "etc/svc.env", contents: "DB_PASSWORD=hunter2\n", mode: 0o600 }],
  },
  {
    name: ".tpl.age decrypts then renders",
    actions: [
      { do: "yml", text: THEME_YML },
      { do: "age", rel: "etc/private.conf.tpl.age", plaintext: "greeting={{ banner.greeting }}" },
      { do: "sweep" },
    ],
    expect: [{ path: "etc/private.conf", contents: "greeting=hello", mode: 0o600 }],
  },
  {
    name: ".age.tpl is rejected at plan time",
    actions: [
      { do: "file", rel: "etc/bad.age.tpl", contents: "x" },
      { do: "sweep" },
    ],
    expect: [
      { path: "etc/bad", absent: true },
      { path: "etc/bad.age", absent: true },
    ],
  },
  {
    name: "a render error skips the target but not the sweep",
    actions: [
      { do: "yml", text: THEME_YML },
      { do: "file", rel: "etc/broken.tpl", contents: "{{ nope.missing }}" },
      { do: "file", rel: "etc/fine", contents: "ok" },
      { do: "sweep" },
    ],
    expect: [
      { path: "etc/broken", absent: true },
      { path: "etc/fine", contents: "ok" },
    ],
  },
  {
    name: "descriptor fans a canonical file out to another target",
    actions: [
      { do: "file", rel: "home/spader/.bashrc", contents: "export EDITOR=nvim\n" },
      { do: "file", rel: "root/.bashrc.bicycle", contents: "from: home/spader/.bashrc\n" },
      { do: "sweep" },
    ],
    expect: [
      { path: "home/spader/.bashrc", contents: "export EDITOR=nvim\n" },
      { path: "root/.bashrc", contents: "export EDITOR=nvim\n" },
      { path: "root/.bashrc.bicycle", absent: true },
    ],
  },
  {
    name: "bare mode descriptor adorns its sibling without conflicting",
    actions: [
      { do: "file", rel: "etc/sudoers.d/extra", contents: "spader ALL=(ALL) ALL\n" },
      { do: "file", rel: "etc/sudoers.d/extra.bicycle", contents: 'mode: "0440"\n' },
      { do: "sweep" },
    ],
    expect: [{ path: "etc/sudoers.d/extra", contents: "spader ALL=(ALL) ALL\n", mode: 0o440 }],
  },
  {
    name: "descriptor consumes a templated sibling (renders, no conflict)",
    actions: [
      { do: "yml", text: THEME_YML },
      { do: "file", rel: "etc/motd.tpl", contents: "{{ banner.greeting }} world\n" },
      { do: "file", rel: "etc/motd.bicycle", contents: 'mode: "0640"\n' },
      { do: "sweep" },
    ],
    expect: [{ path: "etc/motd", contents: "hello world\n", mode: 0o640 }],
  },
  {
    name: "template: false deploys a literal .tpl via its exact-name sibling",
    actions: [
      { do: "file", rel: "etc/literal.tpl", contents: "not {{ rendered }}" },
      { do: "file", rel: "etc/literal.tpl.bicycle", contents: "template: false\n" },
      { do: "sweep" },
    ],
    expect: [
      { path: "etc/literal.tpl", contents: "not {{ rendered }}" },
      { path: "etc/literal", absent: true },
    ],
  },
  {
    name: "descriptor from an encrypted sibling decrypts and defaults 0600",
    actions: [
      { do: "age", rel: "home/spader/.ssh/deploy.age", plaintext: "ssh-ed25519 AAAA\n" },
      { do: "file", rel: "home/spader/.ssh/deploy.bicycle", contents: 'mode: "0644"\n' },
      { do: "sweep" },
    ],
    expect: [{ path: "home/spader/.ssh/deploy", contents: "ssh-ed25519 AAAA\n", mode: 0o644 }],
  },
  {
    name: "explicit descriptor mode beats the secret-taint default",
    actions: [
      { do: "yml", text: THEME_YML },
      { do: "secret", addr: "svc/db", clear: "hunter2" },
      { do: "file", rel: "etc/svc.env.tpl", contents: 'DB={{ "svc/db" | secret }}\n' },
      { do: "file", rel: "etc/svc.env.bicycle", contents: 'mode: "0640"\n' },
      { do: "sweep" },
    ],
    expect: [{ path: "etc/svc.env", contents: "DB=hunter2\n", mode: 0o640 }],
  },
  {
    name: "from may not escape files/ or reference descriptors",
    actions: [
      { do: "secret", addr: "svc/db", clear: "x" },
      { do: "file", rel: "a.bicycle", contents: "from: ../secrets/svc/db.age\n" },
      { do: "file", rel: "b.bicycle", contents: "from: ../age.key\n" },
      { do: "file", rel: "c.bicycle", contents: "from: ../../../etc/passwd\n" },
      { do: "file", rel: "e.bicycle", contents: "from: d.bicycle\n" },
      { do: "file", rel: "d.bicycle", contents: "from: missing\n" },
      { do: "file", rel: "g.bicycle", contents: "from: sub/../../bicycle.yml\n" },
      { do: "sweep" },
    ],
    expect: [
      { path: "a", absent: true },
      { path: "b", absent: true },
      { path: "c", absent: true },
      { path: "d", absent: true },
      { path: "e", absent: true },
      { path: "g", absent: true },
    ],
  },
  {
    name: "from alongside sibling content is an error and nothing half-deploys",
    actions: [
      { do: "file", rel: "etc/other", contents: "other" },
      { do: "file", rel: "etc/dual", contents: "sibling" },
      { do: "file", rel: "etc/dual.bicycle", contents: "from: etc/other\n" },
      { do: "sweep" },
    ],
    expect: [
      { path: "etc/dual", absent: true },
      { path: "etc/other", contents: "other" },
    ],
  },
  {
    name: "ambiguous siblings are an error and nothing half-deploys",
    actions: [
      { do: "file", rel: "etc/amb", contents: "plain" },
      { do: "file", rel: "etc/amb.tpl", contents: "tpl" },
      { do: "file", rel: "etc/amb.bicycle", contents: 'mode: "0600"\n' },
      { do: "sweep" },
    ],
    expect: [{ path: "etc/amb", absent: true }],
  },
  {
    name: "symlink descriptor creates and converges",
    actions: [
      { do: "file", rel: "home/spader/.config/nvim.bicycle", contents: "kind: symlink\nto: /home/spader/.dotfiles/nvim\n" },
      { do: "sweep" },
      { do: "sweep" },
    ],
    expect: [
      { path: "home/spader/.config/nvim", linkTo: "/home/spader/.dotfiles/nvim" },
    ],
  },
  {
    name: "symlink descriptor replaces an existing regular file",
    actions: [
      { do: "host", rel: "etc/target", contents: "old regular file" },
      { do: "file", rel: "etc/target.bicycle", contents: "kind: symlink\nto: /elsewhere\n" },
      { do: "sweep" },
    ],
    expect: [{ path: "etc/target", linkTo: "/elsewhere" }],
  },
  {
    name: "conflicting claims on one target are all skipped",
    actions: [
      { do: "file", rel: "etc/dup", contents: "plain" },
      { do: "file", rel: "etc/dup.tpl", contents: "templated" },
      { do: "sweep" },
    ],
    expect: [{ path: "etc/dup", absent: true }],
  },
  {
    name: "unknown owner falls back to default ownership but still writes",
    actions: [
      { do: "file", rel: "etc/f", contents: "content" },
      { do: "file", rel: "etc/f.bicycle", contents: "owner: no-such-user-zz\n" },
      { do: "sweep" },
    ],
    expect: [{ path: "etc/f", contents: "content" }],
  },
  {
    name: "a target removed from the tree is pruned on the next sweep",
    actions: [
      { do: "file", rel: "etc/keep", contents: "keep" },
      { do: "file", rel: "etc/stale", contents: "stale" },
      { do: "sweep" },
      { do: "rm", rel: "etc/stale" },
      { do: "sweep" },
    ],
    expect: [
      { path: "etc/keep", contents: "keep" },
      { path: "etc/stale", absent: true },
    ],
  },
  {
    name: "renaming a fan-out descriptor moves the target",
    actions: [
      { do: "file", rel: "home/spader/.bashrc", contents: "rc" },
      { do: "file", rel: "root/.bashrc.bicycle", contents: "from: home/spader/.bashrc\n" },
      { do: "sweep" },
      { do: "rm", rel: "root/.bashrc.bicycle" },
      { do: "file", rel: "root/.profile.bicycle", contents: "from: home/spader/.bashrc\n" },
      { do: "sweep" },
    ],
    expect: [
      { path: "root/.bashrc", absent: true },
      { path: "root/.profile", contents: "rc" },
      { path: "home/spader/.bashrc", contents: "rc" },
    ],
  },
  {
    name: "an errored plan never prunes",
    actions: [
      { do: "file", rel: "etc/precious", contents: "v1" },
      { do: "sweep" },
      { do: "rm", rel: "etc/precious" },
      { do: "file", rel: "etc/broken.bicycle", contents: "kind: [not, valid\n" },
      { do: "sweep" },
    ],
    expect: [{ path: "etc/precious", contents: "v1" }],
  },
  {
    name: "pruning resumes once the plan is clean again",
    actions: [
      { do: "file", rel: "etc/precious", contents: "v1" },
      { do: "sweep" },
      { do: "rm", rel: "etc/precious" },
      { do: "file", rel: "etc/broken.bicycle", contents: "kind: [not, valid\n" },
      { do: "sweep" },
      { do: "rm", rel: "etc/broken.bicycle" },
      { do: "sweep" },
    ],
    expect: [{ path: "etc/precious", absent: true }],
  },
];

for (const c of FILES_CASES) {
  test(c.name, () => runFilesCase(c));
}
