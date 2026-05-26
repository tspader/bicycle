export const env = {
  get ETC(): string {
    return process.env.BICYCLE_ETC ?? "/etc/bicycle";
  },
  get VAR(): string {
    return process.env.BICYCLE_VAR ?? "/var/lib/bicycle";
  },
};
