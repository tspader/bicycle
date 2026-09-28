import path from "path";

const root = path.join(import.meta.dir, "..", "..");

export const paths = {
  root,
  cli: {
    entry: path.join(root, "src", "cli", "src", "main.ts"),
  },
  pacman: {
    root: path.join(root, "src", "pacman"),
    pkgbuild: path.join(root, "src", "pacman", "PKGBUILD"),
    install: path.join(root, "src", "pacman", "bicycle.install"),
    files: path.join(root, "src", "pacman", "files"),
  },
  cache: {
    root: path.join(root, ".cache"),
    bin: path.join(root, ".cache", "bin"),
    binary: path.join(root, ".cache", "bin", "bicycle"),
    work: path.join(root, ".cache", "pacman"),
    makepkg: {
      build: path.join(root, ".cache", "pacman", "build"),
      src: path.join(root, ".cache", "pacman", "src"),
      dest: path.join(root, ".cache", "pacman", "dest"),
    },
  },
  build: {
    root: path.join(root, "build"),
    pkg: path.join(root, "build", "pkg"),
  },
};
