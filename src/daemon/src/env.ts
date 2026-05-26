import path from "path";

export const env = {
  get ETC(): string {
    return process.env.BICYCLE_ETC ?? "/etc/bicycle";
  },
  get VAR(): string {
    return process.env.BICYCLE_VAR ?? "/var/lib/bicycle";
  },
  get RUN(): string {
    return process.env.BICYCLE_RUN ?? "/run/bicycle";
  },
  get AGE_KEY(): string {
    return process.env.AGE_KEY ?? path.join(this.ETC, "age.key");
  },
};
