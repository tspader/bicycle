import fs from "fs";
import path from "path";

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const acquire = (file: string): boolean => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  while (true) {
    try {
      const fd = fs.openSync(file, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
    }
    const owner = Number((fs.readFileSync(file, "utf8") || "0").trim());
    if (Number.isFinite(owner) && owner > 0 && isAlive(owner)) {
      return false;
    }
    try {
      fs.unlinkSync(file);
    } catch {}
  }
};

export const release = (file: string): void => {
  try {
    fs.unlinkSync(file);
  } catch {}
};

export const withLock = async <T>(file: string, fn: () => Promise<T>): Promise<T | null> => {
  if (!acquire(file)) return null;
  try {
    return await fn();
  } finally {
    release(file);
  }
};
