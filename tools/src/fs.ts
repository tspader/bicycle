import fs from "fs";
import path from "path";

export const rm = (value: string) => {
  if (fs.existsSync(value)) {
    fs.rmSync(value, { recursive: true, force: true });
  }
};

export const mkdir = (value: string) => {
  fs.mkdirSync(value, { recursive: true });
};

export const copy = (from: string, to: string) => {
  if (!fs.existsSync(from)) {
    throw new Error(`copy: source does not exist: ${from}`);
  }

  if (fs.existsSync(to) && fs.statSync(to).isDirectory()) {
    to = path.join(to, path.basename(from));
  } else {
    mkdir(path.dirname(to));
  }
  fs.cpSync(from, to, { recursive: true, force: true });
};
