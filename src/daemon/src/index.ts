#!/usr/bin/env bun

import { build, type Cli } from "@spader/zargs";
import { serve, reconcile } from "./commands/index";

const raw = await Bun.file(new URL("../package.json", import.meta.url)).json() as { version?: unknown };
const version = typeof raw.version === "string" ? raw.version : undefined;

const def: Cli = {
  name: "bicycle",
  description: "Just like one",
  version,
  commands: {
    serve,
    reconcile,
  },
};

build(def).parse();
