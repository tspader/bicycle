import * as network from "./network";
import * as app from "./app";
import * as git from "./git";
import * as files from "./files";
import * as systemd from "./systemd";
import * as packages from "./packages";
import * as groups from "./groups";
import * as users from "./users";
import * as sudoers from "./sudoers";
import * as dirs from "./dirs";

export { network, app, git, files, systemd, packages, groups, users, sudoers, dirs };

// Canonical reconcile order. groups before users (so custom groups exist for
// membership), users before dirs/files (so home dirs + owners exist), and the
// service/app reconcilers last. A full sweep runs all of these; the installer
// runs only the leading subset inside the target chroot (the rest need a
// running init / network and happen on first boot).
export const ORDER = [
  "groups",
  "users",
  "sudoers",
  "dirs",
  "files",
  "packages",
  "systemd",
  "app",
] as const;

export type ReconcilerName = (typeof ORDER)[number];

const ALL: Record<ReconcilerName, { all: () => Promise<void> }> = {
  groups,
  users,
  sudoers,
  dirs,
  files,
  packages,
  systemd,
  app,
};

export const isReconcilerName = (s: string): s is ReconcilerName =>
  (ORDER as readonly string[]).includes(s);

// Run the named reconcilers in canonical order, regardless of the order of
// `names`. Defaults to a full sweep.
export const run = async (
  names: readonly ReconcilerName[] = ORDER,
): Promise<void> => {
  const want = new Set<ReconcilerName>(names);
  for (const name of ORDER) {
    if (want.has(name)) await ALL[name].all();
  }
};
