import { $ } from "bun";

const NETWORK = "bicycle";

export const reconcile = async (): Promise<void> => {
  const result = await $`docker network inspect ${NETWORK}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    await $`docker network create ${NETWORK}`.quiet();
  }
};
