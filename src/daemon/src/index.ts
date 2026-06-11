#!/usr/bin/env bun

import { build, type Cli } from "@spader/zargs";
import { daemon, diff, reconcile, reconcileOnce, secret } from "./commands/index";
import pkg from "../package.json" with { type: "json" };

const pkgVersion = (pkg as unknown as { version?: unknown }).version;
const version = typeof pkgVersion === "string" ? pkgVersion : undefined;

const def: Cli = {
  name: "bicycle",
  description: "Just like one",
  version,
  commands: {
    daemon,
    diff,
    reconcile,
    "reconcile-once": reconcileOnce,
    secret,
  },
};

build(def).parse();
