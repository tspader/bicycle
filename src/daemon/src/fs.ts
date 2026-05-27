import fs from "fs";

export const chownIgnoreEperm = (target: string, uid: number, gid: number): void => {
  try {
    fs.chownSync(target, uid, gid);
  } catch (e: any) {
    if (e.code !== "EPERM") throw e;
  }
};
