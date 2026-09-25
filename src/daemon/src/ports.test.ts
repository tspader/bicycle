import { test, expect } from "bun:test";
import fs from "fs";
import { useSandbox } from "./testing";
import { paths } from "./paths";
import * as ports from "./ports";

useSandbox();

type Step =
  | { do: "allocate"; name: string; port: number }
  | { do: "release"; name: string }
  | { do: "write" }
  | { do: "read" };

type PortsCase = {
  name: string;
  store?: ports.Store;
  steps: Step[];
  expect: ports.Store;
  file?: string;
  throws?: { allocate: string; error: RegExp };
};

const full = (): ports.Store =>
  Object.fromEntries(
    Array.from({ length: ports.RANGE.last - ports.RANGE.first + 1 }, (_, i) => [
      `app${i}`,
      ports.RANGE.first + i,
    ]),
  );

const PORTS_CASES: PortsCase[] = [
  {
    name: "read of absent file is empty",
    steps: [{ do: "read" }],
    expect: {},
  },
  {
    name: "first allocation is the first port in range",
    steps: [{ do: "allocate", name: "a", port: 20000 }],
    expect: { a: 20000 },
  },
  {
    name: "re-allocating a name returns its port",
    steps: [
      { do: "allocate", name: "a", port: 20000 },
      { do: "allocate", name: "a", port: 20000 },
    ],
    expect: { a: 20000 },
  },
  {
    name: "distinct names get ascending ports",
    steps: [
      { do: "allocate", name: "a", port: 20000 },
      { do: "allocate", name: "b", port: 20001 },
      { do: "allocate", name: "c", port: 20002 },
    ],
    expect: { a: 20000, b: 20001, c: 20002 },
  },
  {
    name: "release then allocate reuses the lowest free port",
    steps: [
      { do: "allocate", name: "a", port: 20000 },
      { do: "allocate", name: "b", port: 20001 },
      { do: "allocate", name: "c", port: 20002 },
      { do: "release", name: "a" },
      { do: "allocate", name: "d", port: 20000 },
    ],
    expect: { b: 20001, c: 20002, d: 20000 },
  },
  {
    name: "release of an unknown name leaves the store alone",
    store: { a: 20000 },
    steps: [{ do: "release", name: "zzz" }],
    expect: { a: 20000 },
  },
  {
    name: "write then read round-trips with sorted keys",
    steps: [
      { do: "allocate", name: "b", port: 20000 },
      { do: "allocate", name: "a", port: 20001 },
      { do: "write" },
      { do: "read" },
    ],
    expect: { a: 20001, b: 20000 },
    file: '{\n  "a": 20001,\n  "b": 20000\n}\n',
  },
  {
    name: "allocation is stable across a restart",
    steps: [
      { do: "allocate", name: "a", port: 20000 },
      { do: "allocate", name: "b", port: 20001 },
      { do: "write" },
      { do: "read" },
      { do: "allocate", name: "a", port: 20000 },
      { do: "allocate", name: "c", port: 20002 },
    ],
    expect: { a: 20000, b: 20001, c: 20002 },
  },
  {
    name: "exhausted range throws",
    store: full(),
    steps: [],
    expect: full(),
    throws: { allocate: "extra", error: /exhausted/ },
  },
];

for (const c of PORTS_CASES) {
  test(`ports: ${c.name}`, () => {
    let store: ports.Store = { ...(c.store ?? {}) };
    for (const s of c.steps) {
      switch (s.do) {
        case "allocate":
          expect(ports.allocate(store, s.name)).toBe(s.port);
          break;
        case "release":
          ports.release(store, s.name);
          break;
        case "write":
          ports.write(store);
          break;
        case "read":
          store = ports.read();
          break;
      }
    }
    if (c.throws) {
      expect(() => ports.allocate(store, c.throws!.allocate)).toThrow(c.throws.error);
    }
    expect(store).toEqual(c.expect);
    if (c.file !== undefined) {
      expect(fs.readFileSync(paths.state.ports, "utf8")).toBe(c.file);
    }
  });
}
