import { $ } from "bun";
import fs from "fs";
import path from "path";

export type EnsureArgs = {
  repo: string;
  ref: string;
  dest: string;
  sparse?: string[];
};

const SAFE = ["-c", "safe.directory=*"];

type ShellPromise = ReturnType<typeof $>;

const run = async (label: string, p: ShellPromise): Promise<void> => {
  const r = await p.nothrow().quiet();
  if (r.exitCode !== 0) {
    const stderr = r.stderr.toString().trim();
    const stdout = r.stdout.toString().trim();
    const detail = stderr || stdout || "(no output)";
    throw new Error(`git ${label} failed (exit ${r.exitCode}): ${detail}`);
  }
};

export const ensure = async ({ repo, ref, dest, sparse }: EnsureArgs): Promise<void> => {
  const gitDir = path.join(dest, ".git");

  if (!fs.existsSync(gitDir)) {
    fs.mkdirSync(dest, { recursive: true });
    await run("init", $`git ${SAFE} -C ${dest} init -q`);
    await run("remote add", $`git ${SAFE} -C ${dest} remote add origin ${repo}`);
    if (sparse && sparse.length > 0) {
      await run("config sparseCheckout", $`git ${SAFE} -C ${dest} config core.sparseCheckout true`);
      await run("sparse-checkout init", $`git ${SAFE} -C ${dest} sparse-checkout init --cone`);
    }
  }

  if (sparse && sparse.length > 0) {
    await run("sparse-checkout set", $`git ${SAFE} -C ${dest} sparse-checkout set ${sparse}`);
  }

  await run(`fetch ${ref} from ${repo}`, $`git ${SAFE} -C ${dest} fetch --depth 1 origin ${ref}`);
  await run("checkout FETCH_HEAD", $`git ${SAFE} -C ${dest} checkout -q FETCH_HEAD`);
};
