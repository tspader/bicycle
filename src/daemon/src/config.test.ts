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
    '    sudo: password',
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
    '    sudo: none',
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

type IngressCase = {
  name: string;
  yml: string;
  expect?: config.BicycleConfig["ingress"];
  throws?: RegExp;
};

const INGRESS_CASES: IngressCase[] = [
  {
    name: "parses domain and routes",
    yml: [
      'ingress:',
      '  domain: aral.lan',
      '  routes:',
      '    recall: 4321',
      '    steve: 7777',
      '',
    ].join('\n'),
    expect: { domain: 'aral.lan', routes: { recall: 4321, steve: 7777 } },
  },
  {
    name: "rejects route port above 65535",
    yml: ['ingress:', '  domain: aral.lan', '  routes:', '    recall: 70000', ''].join('\n'),
    throws: /Too big/,
  },
  {
    name: "rejects route label with uppercase and underscore",
    yml: ['ingress:', '  domain: aral.lan', '  routes:', '    Foo_bar: 80', ''].join('\n'),
    throws: /host label must be lowercase/,
  },
  {
    name: "rejects domain with uppercase",
    yml: ['ingress:', '  domain: Aral.lan', ''].join('\n'),
    throws: /domain must be dot-separated lowercase/,
  },
];

for (const c of INGRESS_CASES) {
  test(`ingress: ${c.name}`, () => {
    write(c.yml);
    if (c.throws) expect(() => config.bicycle()).toThrow(c.throws);
    else expect(config.bicycle().ingress).toEqual(c.expect!);
  });
}

type AppCase = {
  name: string;
  yml: string;
  expect?: config.AppConfig;
  throws?: RegExp;
};

const APP_CASES: AppCase[] = [
  {
    name: "minimal ref",
    yml: 'ref: abc123\n',
    expect: { ref: 'abc123' },
  },
  {
    name: "ref, env, host, expose",
    yml: ['ref: abc123', 'env:', '  A: "1"', 'host: recall', 'expose: false', ''].join('\n'),
    expect: { ref: 'abc123', env: { A: '1' }, host: 'recall', expose: false },
  },
  {
    name: "rejects unknown key",
    yml: ['ref: abc123', 'prot: 80', ''].join('\n'),
    throws: /"code":\s*"unrecognized_keys"[\s\S]*"keys":\s*\[\s*"prot"\s*\]/,
  },
  {
    name: "rejects missing ref",
    yml: 'env: {}\n',
    throws: /"path":\s*\[\s*"ref"\s*\]/,
  },
  {
    name: "rejects host label with uppercase and underscore",
    yml: ['ref: abc123', 'host: Foo_bar', ''].join('\n'),
    throws: /host label must be lowercase/,
  },
];

for (const c of APP_CASES) {
  test(`app: ${c.name}`, () => {
    const dir = path.join(tmp, 'apps', 'myapp');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.yml'), c.yml);
    if (c.throws) expect(() => config.app('myapp')).toThrow(c.throws);
    else expect(config.app('myapp')).toEqual(c.expect!);
  });
}
