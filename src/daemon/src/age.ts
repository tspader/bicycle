import fs from "fs";
import { Decrypter, Encrypter } from "age-encryption";
import { env } from "./env";

const decrypter = (): Decrypter => {
  const keyPath = env.AGE_KEY;
  const d = new Decrypter();
  let added = 0;
  for (const line of fs.readFileSync(keyPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    d.addIdentity(t);
    added++;
  }
  if (added === 0) throw new Error(`no identities in ${keyPath}`);
  return d;
};

export const decrypt = async (path: string): Promise<Uint8Array> => {
  const bytes = fs.readFileSync(path);
  return decrypter().decrypt(new Uint8Array(bytes));
};

export const decryptText = async (path: string): Promise<string> => {
  const bytes = fs.readFileSync(path);
  return decrypter().decrypt(new Uint8Array(bytes), "text");
};

export const encrypt = async (
  bytes: Uint8Array,
  recipients: string[],
): Promise<Uint8Array> => {
  const e = new Encrypter();
  for (const r of recipients) e.addRecipient(r);
  return e.encrypt(bytes);
};
