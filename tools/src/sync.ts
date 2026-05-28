#!/usr/bin/env bun
import { intro, outro, multiselect, confirm, isCancel, cancel, log } from "@clack/prompts";
import path from "path";
import fs from "fs";
import { paths } from "./paths.ts";

const VM_HOST = process.env.BICYCLE_VM_IP ?? "arch-installer.local";
const VM_PORT = '22'
const VM_USER = 'root'

type Mapping = {
  src: string;
  dest: string;
  trailingSlash: boolean;
  excludes: string[];
};

type Target = {
  label: string;
  mappings: Mapping[];
  restart?: string;
};

const targets: Record<string, Target> = {
  binary: {
    label: "/usr/bin/bicycle",
    mappings: [
      {
        src: paths.cache.binary,
        dest: "/usr/bin/bicycle",
        trailingSlash: false,
        excludes: [],
      },
    ],
  },
  etc: {
    label: "/etc/bicycle",
    mappings: [
      {
        src: path.join(paths.root, "example", "machine"),
        dest: "/etc/bicycle",
        trailingSlash: true,
        excludes: ["age.key"],
      },
    ],
  },
  installer: {
    label: "installer source (src/installer + src/shared)",
    restart: "bicycle-installer",
    mappings: [
      {
        src: path.join(paths.root, "src", "installer"),
        dest: "/root/bicycle/src/installer",
        trailingSlash: true,
        excludes: ["node_modules"],
      },
      {
        src: path.join(paths.root, "src", "shared"),
        dest: "/root/bicycle/src/shared",
        trailingSlash: true,
        excludes: ["node_modules"],
      },
    ],
  },
  daemon: {
    label: "daemon source (src/daemon + src/shared)",
    mappings: [
      {
        src: path.join(paths.root, "src", "daemon"),
        dest: "/root/bicycle/src/daemon",
        trailingSlash: true,
        excludes: ["node_modules"],
      },
      {
        src: path.join(paths.root, "src", "shared"),
        dest: "/root/bicycle/src/shared",
        trailingSlash: true,
        excludes: ["node_modules"],
      },
    ],
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

  const sshOpts = `ssh -p ${VM_PORT} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR`;
  const sshArgs = ["-p", VM_PORT, "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR"];

  for (const key of picked as string[]) {
    const t = targets[key];
    if (!t) continue;
    for (const m of t.mappings) {
      if (!fs.existsSync(m.src)) {
        log.error(`missing source: ${m.src}`);
        process.exit(1);
      }
      const src = m.trailingSlash ? `${m.src.replace(/\/+$/, "")}/` : m.src;
      const args = ["-a", "--info=stats1,progress2", "-e", sshOpts];
      if (useDelete) args.push("--delete");
      for (const ex of m.excludes) args.push(`--exclude=${ex}`);
      args.push(src, `${VM_USER}@${VM_HOST}:${m.dest}`);

      log.step(`rsync ${args.join(" ")}`);
      const proc = Bun.spawnSync(["rsync", ...args], { stdio: ["inherit", "inherit", "inherit"] });
      if (!proc.success) {
        log.error(`rsync failed (exit ${proc.exitCode}) for ${t.label}`);
        process.exit(proc.exitCode ?? 1);
      }
    }

    if (t.restart) {
      log.step(`systemctl restart ${t.restart}`);
      const proc = Bun.spawnSync(
        ["ssh", ...sshArgs, `${VM_USER}@${VM_HOST}`, `systemctl restart ${t.restart}`],
        { stdio: ["inherit", "inherit", "inherit"] },
      );
      if (!proc.success) {
        log.error(`restart failed (exit ${proc.exitCode}) for ${t.restart}`);
        process.exit(proc.exitCode ?? 1);
      }
    }
  }

  outro("done");
};

await main();
