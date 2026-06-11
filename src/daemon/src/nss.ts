import { $ } from "bun";

// Name → id resolution via getent, so NSS answers from the *target* system:
// inside the installer's arch-chroot this reads the new machine's passwd/group,
// and the users reconciler runs before anything that needs these (see
// reconcilers ORDER), so declared users already exist.
export const lookupUid = async (name: string): Promise<number | null> => {
  const r = await $`getent passwd ${name}`.quiet().nothrow();
  if (r.exitCode !== 0) return null;
  const uid = Number(r.stdout.toString().trim().split(":")[2]);
  return Number.isInteger(uid) ? uid : null;
};

export const lookupGid = async (name: string): Promise<number | null> => {
  const r = await $`getent group ${name}`.quiet().nothrow();
  if (r.exitCode !== 0) return null;
  const gid = Number(r.stdout.toString().trim().split(":")[2]);
  return Number.isInteger(gid) ? gid : null;
};
