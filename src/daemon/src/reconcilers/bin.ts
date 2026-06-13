export const bin = (name: string): string =>
  Bun.which(name, { PATH: process.env.PATH ?? "" }) ?? name;
