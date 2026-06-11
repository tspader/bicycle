import { test, expect } from "bun:test";
import fs from "fs";
import { useSandbox, runReconcilerCase, backdate, type ReconcilerCase } from "../testing";
import * as files from "./files";

const sb = useSandbox();

const THEME = {
  vars: {
    theme: { background: "#1F1F1F" },
    banner: { greeting: "hello" },
    hosts: ["alpha", "beta"],
  },
};

const CASES: ReconcilerCase[] = [
  {
    name: "mirrors plaintext file into host root with the source's mode",
    actions: [
      { do: "file", rel: "etc/foo.conf", contents: "hello", mode: 0o644 },
      { do: "sweep" },
    ],
    fs: [{ path: "etc/foo.conf", contents: "hello", mode: 0o644 }],
  },
  {
    name: "preserves the executable bit from the source",
    actions: [
      { do: "file", rel: "usr/local/bin/hook", contents: "#!/bin/sh\necho hi\n", mode: 0o755 },
      { do: "sweep" },
    ],
    fs: [{ path: "usr/local/bin/hook", mode: 0o755 }],
  },
  {
    name: "decrypts .age files, strips suffix, and forces 0600",
    actions: [
      { do: "age", rel: "etc/secret.conf.age", plaintext: "decrypted" },
      { do: "sweep" },
    ],
    fs: [
      { path: "etc/secret.conf", contents: "decrypted", mode: 0o600 },
      { path: "etc/secret.conf.age", absent: true },
    ],
  },
  {
    name: "fixes a stale mode even when content is unchanged",
    actions: [
      { do: "file", rel: "etc/foo.conf", contents: "hello", mode: 0o644 },
      { do: "sweep" },
      { do: "chmodHost", rel: "etc/foo.conf", mode: 0o600 },
      { do: "sweep" },
    ],
    fs: [{ path: "etc/foo.conf", mode: 0o644 }],
  },
  {
    name: "creates nested parent directories",
    actions: [
      { do: "file", rel: "a/b/c/d.txt", contents: "deep" },
      { do: "sweep" },
    ],
    fs: [{ path: "a/b/c/d.txt", contents: "deep" }],
  },
  {
    name: "rewrites when source content changes",
    actions: [
      { do: "file", rel: "foo", contents: "v1" },
      { do: "sweep" },
      { do: "file", rel: "foo", contents: "v2" },
      { do: "sweep" },
    ],
    fs: [{ path: "foo", contents: "v2" }],
  },
  {
    name: "continues past a bad .age file",
    actions: [
      { do: "file", rel: "etc/bad.age", contents: "not-actually-age-encrypted" },
      { do: "file", rel: "etc/good", contents: "ok" },
      { do: "sweep" },
    ],
    fs: [
      { path: "etc/bad", absent: true },
      { path: "etc/good", contents: "ok" },
    ],
  },
  {
    name: "no-op when source root does not exist",
    actions: [{ do: "sweep" }],
    plan: [],
  },
  {
    name: "renders a .tpl against bicycle.yml vars and strips the suffix",
    actions: [
      { do: "config", config: THEME },
      { do: "file", rel: "etc/motd.tpl", contents: "greeting: {{ banner.greeting }}\n" },
      { do: "sweep" },
    ],
    fs: [
      { path: "etc/motd", contents: "greeting: hello\n", mode: 0o644 },
      { path: "etc/motd.tpl", absent: true },
    ],
  },
  {
    name: "renders filters and for loops",
    actions: [
      { do: "config", config: THEME },
      { do: "file", rel: "etc/app.conf.tpl", contents: "bg={{ theme.background | strip }};{% for h in hosts %}{{ h }};{% endfor %}" },
      { do: "sweep" },
    ],
    fs: [{ path: "etc/app.conf", contents: "bg=1F1F1F;alpha;beta;" }],
  },
  {
    name: "template that resolves a secret defaults to 0600",
    actions: [
      { do: "config", config: THEME },
      { do: "secret", addr: "svc/db", clear: "hunter2" },
      { do: "file", rel: "etc/svc.env.tpl", contents: 'DB_PASSWORD={{ "svc/db" | secret }}\n' },
      { do: "sweep" },
    ],
    fs: [{ path: "etc/svc.env", contents: "DB_PASSWORD=hunter2\n", mode: 0o600 }],
  },
  {
    name: ".tpl.age decrypts then renders",
    actions: [
      { do: "config", config: THEME },
      { do: "age", rel: "etc/private.conf.tpl.age", plaintext: "greeting={{ banner.greeting }}" },
      { do: "sweep" },
    ],
    fs: [{ path: "etc/private.conf", contents: "greeting=hello", mode: 0o600 }],
  },
  {
    name: ".age.tpl is rejected at plan time",
    actions: [
      { do: "file", rel: "etc/bad.age.tpl", contents: "x" },
      { do: "sweep" },
    ],
    fs: [
      { path: "etc/bad", absent: true },
      { path: "etc/bad.age", absent: true },
    ],
  },
  {
    name: "a render error skips the target but not the sweep",
    actions: [
      { do: "config", config: THEME },
      { do: "file", rel: "etc/broken.tpl", contents: "{{ nope.missing }}" },
      { do: "file", rel: "etc/fine", contents: "ok" },
      { do: "sweep" },
    ],
    fs: [
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
    fs: [
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
    fs: [{ path: "etc/sudoers.d/extra", contents: "spader ALL=(ALL) ALL\n", mode: 0o440 }],
  },
  {
    name: "descriptor consumes a templated sibling (renders, no conflict)",
    actions: [
      { do: "config", config: THEME },
      { do: "file", rel: "etc/motd.tpl", contents: "{{ banner.greeting }} world\n" },
      { do: "file", rel: "etc/motd.bicycle", contents: 'mode: "0640"\n' },
      { do: "sweep" },
    ],
    fs: [{ path: "etc/motd", contents: "hello world\n", mode: 0o640 }],
  },
  {
    name: "template: false deploys a literal .tpl via its exact-name sibling",
    actions: [
      { do: "file", rel: "etc/literal.tpl", contents: "not {{ rendered }}" },
      { do: "file", rel: "etc/literal.tpl.bicycle", contents: "template: false\n" },
      { do: "sweep" },
    ],
    fs: [
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
    fs: [{ path: "home/spader/.ssh/deploy", contents: "ssh-ed25519 AAAA\n", mode: 0o644 }],
  },
  {
    name: "explicit descriptor mode beats the secret-taint default",
    actions: [
      { do: "config", config: THEME },
      { do: "secret", addr: "svc/db", clear: "hunter2" },
      { do: "file", rel: "etc/svc.env.tpl", contents: 'DB={{ "svc/db" | secret }}\n' },
      { do: "file", rel: "etc/svc.env.bicycle", contents: 'mode: "0640"\n' },
      { do: "sweep" },
    ],
    fs: [{ path: "etc/svc.env", contents: "DB=hunter2\n", mode: 0o640 }],
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
    fs: [
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
    fs: [
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
    fs: [{ path: "etc/amb", absent: true }],
  },
  {
    name: "symlink descriptor creates and converges",
    actions: [
      { do: "file", rel: "home/spader/.config/nvim.bicycle", contents: "kind: symlink\nto: /home/spader/.dotfiles/nvim\n" },
      { do: "sweep" },
      { do: "sweep" },
    ],
    fs: [{ path: "home/spader/.config/nvim", linkTo: "/home/spader/.dotfiles/nvim" }],
    plan: [],
  },
  {
    name: "symlink descriptor replaces an existing regular file",
    actions: [
      { do: "host", rel: "etc/target", contents: "old regular file" },
      { do: "file", rel: "etc/target.bicycle", contents: "kind: symlink\nto: /elsewhere\n" },
      { do: "sweep" },
    ],
    fs: [{ path: "etc/target", linkTo: "/elsewhere" }],
  },
  {
    name: "conflicting claims on one target are all skipped",
    actions: [
      { do: "file", rel: "etc/dup", contents: "plain" },
      { do: "file", rel: "etc/dup.tpl", contents: "templated" },
      { do: "sweep" },
    ],
    fs: [{ path: "etc/dup", absent: true }],
  },
  {
    name: "unknown owner falls back to default ownership but still writes",
    actions: [
      { do: "file", rel: "etc/f", contents: "content" },
      { do: "file", rel: "etc/f.bicycle", contents: "owner: no-such-user-zz\n" },
      { do: "sweep" },
    ],
    fs: [{ path: "etc/f", contents: "content" }],
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
    fs: [
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
    fs: [
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
    fs: [{ path: "etc/precious", contents: "v1" }],
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
    fs: [{ path: "etc/precious", absent: true }],
  },
  {
    name: "plan: undeployed file yields an exists diff and writes nothing",
    actions: [{ do: "file", rel: "etc/foo.conf", contents: "hello" }],
    plan: [{ type: "file", id: "etc/foo.conf", field: "exists", expected: true, actual: false }],
    fs: [{ path: "etc/foo.conf", absent: true }],
  },
  {
    name: "plan: clean after a sweep",
    actions: [
      { do: "file", rel: "etc/foo.conf", contents: "hello" },
      { do: "sweep" },
    ],
    plan: [],
  },
  {
    name: "plan: host content drift yields a content diff",
    actions: [
      { do: "file", rel: "etc/foo.conf", contents: "hello" },
      { do: "sweep" },
      { do: "host", rel: "etc/foo.conf", contents: "tampered" },
    ],
    plan: [{ type: "file", id: "etc/foo.conf", field: "content" }],
  },
  {
    name: "plan: host mode drift yields a mode diff",
    actions: [
      { do: "file", rel: "etc/foo.conf", contents: "hello", mode: 0o644 },
      { do: "sweep" },
      { do: "chmodHost", rel: "etc/foo.conf", mode: 0o600 },
    ],
    plan: [{ type: "file", id: "etc/foo.conf", field: "mode", expected: "0644", actual: "0600" }],
  },
  {
    name: "plan: drift on an encrypted target is redacted",
    actions: [
      { do: "age", rel: "etc/secret.conf.age", plaintext: "v1" },
      { do: "sweep" },
      { do: "host", rel: "etc/secret.conf", contents: "tampered" },
    ],
    plan: [{ type: "file", id: "etc/secret.conf", field: "content", redacted: true }],
  },
  {
    name: "plan: removed source yields a prune diff",
    actions: [
      { do: "file", rel: "etc/stale", contents: "stale" },
      { do: "sweep" },
      { do: "rm", rel: "etc/stale" },
    ],
    plan: [{ type: "file", id: "etc/stale", field: "exists", expected: false, actual: true }],
  },
  {
    name: "plan: an errored plan suppresses prune diffs",
    actions: [
      { do: "file", rel: "etc/precious", contents: "v1" },
      { do: "sweep" },
      { do: "rm", rel: "etc/precious" },
      { do: "file", rel: "etc/broken.bicycle", contents: "kind: [not, valid\n" },
    ],
    plan: [],
  },
  {
    name: "plan: changed symlink descriptor yields a target diff",
    actions: [
      { do: "file", rel: "etc/link.bicycle", contents: "kind: symlink\nto: /old\n" },
      { do: "sweep" },
      { do: "file", rel: "etc/link.bicycle", contents: "kind: symlink\nto: /new\n" },
    ],
    plan: [{ type: "symlink", id: "etc/link", field: "target", expected: "/new", actual: "/old" }],
  },
  {
    name: "kind switch symlink->file replaces the link itself",
    actions: [
      { do: "file", rel: "etc/link.bicycle", contents: "kind: symlink\nto: /nonexistent-bicycle-test-9b3c\n" },
      { do: "sweep" },
      { do: "rm", rel: "etc/link.bicycle" },
      { do: "file", rel: "etc/link", contents: "now a file" },
      { do: "sweep" },
    ],
    fs: [{ path: "etc/link", contents: "now a file", mode: 0o644 }],
    plan: [],
  },
  {
    name: "declared file whose dest is a directory: kind diff, dir intact",
    actions: [
      { do: "hostDir", rel: "etc/appdir" },
      { do: "host", rel: "etc/appdir/data", contents: "user data" },
      { do: "file", rel: "etc/appdir", contents: "managed" },
      { do: "sweep" },
    ],
    fs: [
      { path: "etc/appdir", dir: true },
      { path: "etc/appdir/data", contents: "user data" },
    ],
    plan: [{ type: "file", id: "etc/appdir", field: "kind", expected: "file", actual: "dir" }],
  },
  {
    name: "owner-only descriptor yields owner diff, no spurious group diff",
    skipIf: process.getuid !== undefined && process.getuid() === 0,
    actions: [
      { do: "file", rel: "etc/owned", contents: "x" },
      { do: "file", rel: "etc/owned.bicycle", contents: "owner: root\n" },
      { do: "sweep" },
    ],
    fs: [{ path: "etc/owned", contents: "x" }],
    plan: [{ type: "file", id: "etc/owned", field: "owner", expected: 0 }],
  },
  {
    name: "secret-bearing template converges (plan empty after sweep)",
    actions: [
      { do: "config", config: {} },
      { do: "secret", addr: "svc/db", clear: "hunter2" },
      { do: "file", rel: "etc/svc.env.tpl", contents: 'DB={{ "svc/db" | secret }}\n' },
      { do: "sweep" },
    ],
    fs: [{ path: "etc/svc.env", contents: "DB=hunter2\n", mode: 0o600 }],
    plan: [],
  },
  {
    name: "a stale symlink target is pruned",
    actions: [
      { do: "file", rel: "etc/link.bicycle", contents: "kind: symlink\nto: /nonexistent-bicycle-test-9b3c\n" },
      { do: "sweep" },
      { do: "rm", rel: "etc/link.bicycle" },
      { do: "sweep" },
    ],
    fs: [{ path: "etc/link", absent: true }],
    plan: [],
  },
];

for (const c of CASES) {
  test.skipIf(c.skipIf === true)(c.name, () => runReconcilerCase(sb, files, files.all, c));
}

test("idempotent: second pass does not rewrite unchanged files", async () => {
  fs.mkdirSync(sb.etcPath("files"), { recursive: true });
  fs.writeFileSync(sb.etcPath("files/foo"), "same");
  await files.all();
  const dest = sb.hostPath("foo");
  const stamp = backdate(dest);
  await files.all();
  expect(fs.statSync(dest).mtimeMs).toBe(stamp);
});
