import { $ } from "bun";
import { paths } from '../paths.ts'

export default async () => {
  await $`bun build --cwd=${paths.root} --compile --minify --target=bun-linux-x64 ${paths.daemon.entry} --outfile=${paths.cache.binary}`
};
