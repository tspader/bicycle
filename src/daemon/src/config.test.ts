import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import * as config from "./config";

let tmp: string;
let saved: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bicycle-config-"));
  saved = process.env.BICYCLE_ETC;
  process.env.BICYCLE_ETC = tmp;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (saved === undefined) delete process.env.BICYCLE_ETC;
  else process.env.BICYCLE_ETC = saved;
});

const write = (body: string) => {
  fs.writeFileSync(path.join(tmp, "bicycle.yml"), body);
};

test("parses catalog and systemd from a unified document", () => {
  write([
    'core:',
    '  hostname: spum-cannon',
    '  timezone: UTC',
    '  kernels: [linux]',
    '  ntp: true',
    'catalog:',
    '  url: "git://192.168.0.211/bikeshop"',
    'systemd:',
    '  enable: [docker.service, sshd.service]',
    '',
  ].join('\n'));
  const cfg = config.bicycle();
  expect(cfg.catalog?.url).toBe('git://192.168.0.211/bikeshop');
  expect(cfg.systemd?.enable).toEqual(['docker.service', 'sshd.service']);
});

test("parses the checked-in example/machine/bicycle.yml", () => {
  const src = fs.readFileSync(
    path.join(import.meta.dir, '..', '..', '..', 'example', 'machine', 'bicycle.yml'),
    'utf8',
  );
  fs.writeFileSync(path.join(tmp, 'bicycle.yml'), src);
  const cfg = config.bicycle();
  expect(cfg.core?.hostname).toBeTruthy();
});
