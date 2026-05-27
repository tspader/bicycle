import { paths } from "./paths";
import * as age from "./age";

export const resolve = async (addr: string): Promise<string> =>
  age.decryptText(paths.etc.secret(addr));
