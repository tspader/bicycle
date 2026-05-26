import { Glob } from "bun";

import { paths } from '../paths.ts'
import { copy, rm, mkdir } from '../fs.ts'

const stageWork = () => {
  rm(paths.cache.work);
  mkdir(paths.cache.work);
  copy(paths.pacman.pkgbuild, paths.cache.work);
  copy(paths.pacman.files, paths.cache.work);
  copy(paths.cache.binary, paths.cache.work);
  console.log(`staged makepkg work dir -> ${paths.cache.work}`);
};

const runMakepkg = async () => {
  rm(paths.cache.makepkg.build);
  rm(paths.cache.makepkg.src);
  rm(paths.cache.makepkg.dest);
  mkdir(paths.cache.makepkg.build);
  mkdir(paths.cache.makepkg.src);
  mkdir(paths.cache.makepkg.dest);

  const env = {
    ...process.env,
    BUILDDIR: paths.cache.makepkg.build,
    SRCDEST: paths.cache.makepkg.src,
    PKGDEST: paths.cache.makepkg.dest,
  };

  const result = Bun.spawnSync(["makepkg", "-f", "--noconfirm"], {
    cwd: paths.cache.work,
    env,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (!result.success) {
    throw new Error(`makepkg exited with code ${result.exitCode}`);
  }
};

const collect = () => {
  rm(paths.build.pkg);
  mkdir(paths.build.pkg);
  const glob = new Glob("*.pkg.tar.zst");
  let count = 0;
  for (const file of glob.scanSync({ cwd: paths.cache.makepkg.dest, absolute: true })) {
    copy(file, paths.build.pkg);
    console.log(`packaged -> ${file}`);
    count++;
  }
  if (count === 0) {
    throw new Error(`no .pkg.tar.zst produced in ${paths.cache.makepkg.dest}`);
  }
};

export default async () => {
  stageWork();
  await runMakepkg();
  collect();
}
