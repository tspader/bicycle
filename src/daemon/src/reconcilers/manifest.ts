import fs from "fs";
import path from "path";
import { paths } from "../paths";

export type DataEntry = {
  path: string;
  owner?: string;
};

export type ServiceManifest = {
  data?: DataEntry[];
};

export type EnvSpec = {
  required?: string[];
  optional?: string[];
};

export type Manifest = {
  services?: Record<string, ServiceManifest>;
  env?: EnvSpec;
};

export type Owner = { uid: number; gid: number };

export type Mount = {
  service: string;
  hostPath: string;
  containerPath: string;
  owner?: Owner;
};

const TOP_KEYS = new Set(["services", "env"]);
const SERVICE_KEYS = new Set(["data"]);
const DATA_KEYS = new Set(["path", "owner"]);
const ENV_KEYS = new Set(["required", "optional"]);

const checkKeys = (where: string, obj: object, allowed: Set<string>): void => {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      throw new Error(
        `${where}: unknown key "${k}" (allowed: ${[...allowed].join(", ")})`,
      );
    }
  }
};

export const load = (manifestPath: string): Manifest => {
  if (!fs.existsSync(manifestPath)) return {};
  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = Bun.YAML.parse(raw);
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`manifest at ${manifestPath} must be a YAML mapping`);
  }

  checkKeys(manifestPath, parsed, TOP_KEYS);
  const m = parsed as Manifest;

  if (m.env) checkKeys(`${manifestPath}: env`, m.env, ENV_KEYS);

  for (const [svcName, svc] of Object.entries(m.services ?? {})) {
    checkKeys(`${manifestPath}: services.${svcName}`, svc, SERVICE_KEYS);
    for (const [i, entry] of (svc.data ?? []).entries()) {
      checkKeys(`${manifestPath}: services.${svcName}.data[${i}]`, entry, DATA_KEYS);
    }
  }

  return m;
};

export const parseOwner = (s: string): Owner => {
  const m = /^(\d+):(\d+)$/.exec(s.trim());
  if (!m) throw new Error(`invalid owner "${s}", expected "uid:gid"`);
  return { uid: parseInt(m[1]!, 10), gid: parseInt(m[2]!, 10) };
};

export const planMounts = (
  manifest: Manifest,
  appName: string,
): Mount[] => {
  const out: Mount[] = [];
  const app = paths.state.app(appName);
  for (const [service, svc] of Object.entries(manifest.services ?? {})) {
    for (const entry of svc.data ?? []) {
      if (!entry.path || !entry.path.startsWith("/")) {
        throw new Error(
          `service "${service}": data.path must be an absolute container path, got "${entry.path}"`,
        );
      }
      const base = path.basename(entry.path);
      if (!base || base === "/" || base === ".") {
        throw new Error(
          `service "${service}": cannot derive host subdir from container path "${entry.path}"`,
        );
      }
      out.push({
        service,
        hostPath: app.mount(service, base),
        containerPath: entry.path,
        owner: entry.owner ? parseOwner(entry.owner) : undefined,
      });
    }
  }
  return out;
};

export const generateOverride = (mounts: Mount[]): string | null => {
  if (mounts.length === 0) return null;

  const byService: Record<string, Mount[]> = {};
  for (const m of mounts) {
    (byService[m.service] ??= []).push(m);
  }

  const services: Record<string, { volumes: object[] }> = {};
  for (const [service, ms] of Object.entries(byService)) {
    services[service] = {
      volumes: ms.map((m) => ({
        type: "bind",
        source: m.hostPath,
        target: m.containerPath,
      })),
    };
  }

  return JSON.stringify({ services }, null, 2) + "\n";
};

export const validateEnv = (
  spec: EnvSpec | undefined,
  resolved: Record<string, string>,
  appName: string,
): void => {
  const required = spec?.required ?? [];
  const missing = required.filter((k) => !(k in resolved));
  if (missing.length > 0) {
    throw new Error(
      `app "${appName}" missing required env: ${missing.join(", ")}`,
    );
  }
};
