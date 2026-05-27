import fs from "fs";
import path from "path";
import pino from "pino";
import pretty from "pino-pretty";
import { paths } from "./paths";

interface Store {
  logger?: pino.Logger;
}

const store: Store = {};

const tryFileStream = (): pino.DestinationStream | null => {
  const dest = paths.state.log("bicycle.log");
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
  } catch {
    return null;
  }
  return pino.destination({ dest, sync: false });
};

const build = (): pino.Logger => {
  if (process.env.NODE_ENV === "test") return pino({ level: "silent" });

  const prettyStream = pretty({ colorize: true });
  const fileStream = tryFileStream();
  const streams = fileStream
    ? [{ stream: prettyStream }, { stream: fileStream }]
    : [{ stream: prettyStream }];

  return pino(
    { level: process.env.LOG_LEVEL ?? "info" },
    pino.multistream(streams),
  );
};

export const logger = (): pino.Logger => {
  if (!store.logger) store.logger = build();
  return store.logger;
};

export const log: pino.Logger = new Proxy({} as pino.Logger, {
  get(_, k) {
    const v = logger()[k as keyof pino.Logger];
    if (typeof v === "function") return v.bind(logger());
    return v;
  },
});
