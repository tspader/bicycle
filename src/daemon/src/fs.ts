import fs from "fs";
import path from "path";

export const chownIgnoreEperm = (target: string, uid: number, gid: number): void => {
  try {
    fs.chownSync(target, uid, gid);
  } catch (e: any) {
    if (e.code !== "EPERM") throw e;
  }
};

const lchownIgnoreEperm = (target: string, uid: number, gid: number): void => {
  try {
    fs.lchownSync(target, uid, gid);
  } catch (e: any) {
    if (e.code !== "EPERM") throw e;
  }
};

export const chownRecursiveIfNeeded = (
  target: string,
  uid: number,
  gid: number,
): void => {
  const st = fs.lstatSync(target);
  if (st.uid !== uid || st.gid !== gid) {
    lchownIgnoreEperm(target, uid, gid);
  }
  if (!st.isDirectory()) return;
  for (const ent of fs.readdirSync(target, { withFileTypes: true })) {
    chownRecursiveIfNeeded(path.join(target, ent.name), uid, gid);
  }
};
