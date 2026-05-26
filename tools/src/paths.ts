import path from "path";

const root = path.join(import.meta.dir, "..", "..");

export const paths = {
  root,
  daemon: {
    entry: path.join(root, "src", "daemon", "src", "index.ts"),
  },
  pacman: {
    root: path.join(root, "src", "pacman"),
    pkgbuild: path.join(root, "src", "pacman", "PKGBUILD"),
    files: path.join(root, "src", "pacman", "files"),
  },
  cache: {
    root: path.join(root, ".cache"),
    bin: path.join(root, ".cache", "daemon"),
    binary: path.join(root, ".cache", "daemon", "bicycle"),
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
