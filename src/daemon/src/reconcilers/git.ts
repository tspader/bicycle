import { $ } from "bun";
import fs from "fs";
import path from "path";

export type EnsureArgs = {
  repo: string;
  ref: string;
  dest: string;
  sparse?: string[];
};

export const ensure = async ({ repo, ref, dest, sparse }: EnsureArgs): Promise<void> => {
  const gitDir = path.join(dest, ".git");

  if (!fs.existsSync(gitDir)) {
    fs.mkdirSync(dest, { recursive: true });
    await $`git -C ${dest} init -q`.quiet();
    await $`git -C ${dest} remote add origin ${repo}`.quiet();
    if (sparse && sparse.length > 0) {
      await $`git -C ${dest} config core.sparseCheckout true`.quiet();
      await $`git -C ${dest} sparse-checkout init --cone`.quiet();
    }
  }

  if (sparse && sparse.length > 0) {
    await $`git -C ${dest} sparse-checkout set ${sparse}`.quiet();
  }

  await $`git -C ${dest} fetch --depth 1 origin ${ref}`.quiet();
  await $`git -C ${dest} checkout -q FETCH_HEAD`.quiet();
};
