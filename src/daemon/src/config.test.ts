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

test("resolves vars into typed fields (uid as number) before zod", () => {
  write([
    'vars:',
    '  admin:',
    '    uid: 1000',
    '  media_gid: 1001',
    'users:',
    '  - name: spader',
    '    uid: ${admin.uid}',
    '    sudo: true',
    '    groups: [wheel, media]',
    'groups:',
    '  - name: media',
    '    gid: ${media_gid}',
    '',
  ].join('\n'));
  const cfg = config.bicycle();
  expect(cfg.users?.[0]?.uid).toBe(1000);
  expect(cfg.groups?.[0]?.gid).toBe(1001);
});

test("vars cannot reference other vars", () => {
  write([
    'vars:',
    '  base: 1000',
    '  derived: ${base}',
    '',
  ].join('\n'));
  expect(() => config.bicycle()).toThrow(/cannot reference/);
});

test("unknown var ref in bicycle.yml throws", () => {
  write([
    'users:',
    '  - name: x',
    '    uid: ${nope}',
    '    sudo: false',
    '    groups: []',
    '',
  ].join('\n'));
  expect(() => config.bicycle()).toThrow(/unresolved/);
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
