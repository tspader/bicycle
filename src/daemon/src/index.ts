#!/usr/bin/env bun

import { build, type Cli } from "@spader/zargs";
import { daemon, reconcile } from "./commands/index";
import pkg from "../package.json" with { type: "json" };

const version = typeof (pkg as { version?: unknown }).version === "string"
  ? (pkg as { version: string }).version
  : undefined;

const def: Cli = {
  name: "bicycle",
  description: "Just like one",
  version,
  commands: {
    daemon,
    reconcile,
  },
};

build(def).parse();
