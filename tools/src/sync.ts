#!/usr/bin/env bun
import { intro, outro, multiselect, confirm, isCancel, cancel, log } from "@clack/prompts";
import path from "path";
import fs from "fs";
import { paths } from "./paths.ts";

const VM_HOST = process.env.BICYCLE_VM_IP ?? "arch-installer.local";
const VM_PORT = '22'
const VM_USER = 'root'

type Target = {
  label: string;
  src: string;
  dest: string;
  trailingSlash: boolean;
  excludes: string[];
};

const targets: Record<string, Target> = {
  binary: {
    label: "/usr/bin/bicycle",
    src: paths.cache.binary,
    dest: "/usr/bin/bicycle",
    trailingSlash: false,
    excludes: [],
  },
  etc: {
    label: "/etc/bicycle",
    src: path.join(paths.root, "example", "machine"),
    dest: "/etc/bicycle",
    trailingSlash: true,
    excludes: ["age.key"],
  },
};

const main = async () => {
  const picked = await multiselect({
    message: `Sync to ${VM_USER}@${VM_HOST}:${VM_PORT}`,
    options: Object.entries(targets).map(([value, t]) => ({ value, label: t.label })),
    required: true,
  });
  if (isCancel(picked)) {
    cancel("aborted");
    process.exit(0);
  }

  const useDelete = await confirm({
    message: "Use --delete (remove destination files not in source)?",
    initialValue: false,
  });
  if (isCancel(useDelete)) {
    cancel("aborted");
    process.exit(0);
  }

  for (const key of picked as string[]) {
    const t = targets[key];
    if (!fs.existsSync(t.src)) {
      log.error(`missing source: ${t.src}`);
      process.exit(1);
    }
    const src = t.trailingSlash ? `${t.src.replace(/\/+$/, "")}/` : t.src;
    const sshOpts = `ssh -p ${VM_PORT} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR`;
    const args = ["-a", "--info=stats1,progress2", "-e", sshOpts];
    if (useDelete) args.push("--delete");
    for (const ex of t.excludes) args.push(`--exclude=${ex}`);
    args.push(src, `${VM_USER}@${VM_HOST}:${t.dest}`);

    log.step(`rsync ${args.join(" ")}`);
    const proc = Bun.spawnSync(["rsync", ...args], { stdio: ["inherit", "inherit", "inherit"] });
    if (!proc.success) {
      log.error(`rsync failed (exit ${proc.exitCode}) for ${t.label}`);
      process.exit(proc.exitCode ?? 1);
    }
  }

  outro("done");
};

await main();
