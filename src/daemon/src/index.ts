#!/usr/bin/env bun

import { build, type Cli } from "@spader/zargs";
import { daemon, reconcile } from "./commands/index";
import pkg from "../package.json" with { type: "json" };

const pkgVersion = (pkg as unknown as { version?: unknown }).version;
const version = typeof pkgVersion === "string" ? pkgVersion : undefined;

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
