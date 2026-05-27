import { $ } from "bun";
import { log } from "../logger";

const NETWORK = "bicycle";

export const ensure = async (): Promise<void> => {
  const result = await $`docker network inspect ${NETWORK}`.quiet().nothrow();
  if (result.exitCode === 0) return;
  log.info({ network: NETWORK }, "network: creating");
  await $`docker network create ${NETWORK}`.quiet();
  log.info({ network: NETWORK }, "network: created");
};
