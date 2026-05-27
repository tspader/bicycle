import { test, expect } from "bun:test";
import * as vars from "./vars";

test("get: dotted path traversal", () => {
  const obj = { a: { b: { c: 5 } } };
  expect(vars.get(obj, "a.b.c")).toBe(5);
  expect(vars.get(obj, "a.b")).toEqual({ c: 5 });
  expect(vars.get(obj, "a.x")).toBeUndefined();
  expect(vars.get(obj, "missing")).toBeUndefined();
  expect(vars.get(obj, "a.b.c.d")).toBeUndefined();
});

test("walk: whole-string substitution preserves type", () => {
  const out = vars.walk({ uid: "${admin.uid}" }, { admin: { uid: 1000 } });
  expect(out).toEqual({ uid: 1000 });
});

test("walk: mixed string interpolates to string", () => {
  const out = vars.walk(
    { url: "http://${host}.lan/${path}" },
    { host: "miniflux", path: "api" },
  );
  expect(out).toEqual({ url: "http://miniflux.lan/api" });
});

test("walk: throws on unknown name", () => {
  expect(() => vars.walk({ x: "${nope}" }, {})).toThrow(/unresolved/);
});

test("walk: throws on object substitution", () => {
  expect(() => vars.walk({ x: "${admin}" }, { admin: { uid: 1 } })).toThrow(/object/);
});

test("walk: nested traversal in arrays + objects", () => {
  const out = vars.walk(
    { users: [{ uid: "${admin.uid}" }, { uid: "${other.uid}" }] },
    { admin: { uid: 1000 }, other: { uid: 1001 } },
  );
  expect(out).toEqual({ users: [{ uid: 1000 }, { uid: 1001 }] });
});

test("validateTable: undefined → empty", () => {
  expect(vars.validateTable(undefined)).toEqual({});
});

test("validateTable: scalars + nested pass through", () => {
  const input = { a: 1, b: "x", c: true, nested: { x: 5 } };
  expect(vars.validateTable(input)).toEqual(input);
});

test("validateTable: rejects ${...} reference at top level", () => {
  expect(() => vars.validateTable({ a: "${b}" })).toThrow(/cannot reference/);
});

test("validateTable: rejects ${...} inside nested value", () => {
  expect(() => vars.validateTable({ a: { b: "x${c}" } })).toThrow(/cannot reference/);
});

test("validateTable: rejects ${...} inside arrays", () => {
  expect(() => vars.validateTable({ a: ["${b}"] })).toThrow(/cannot reference/);
});

test("validateTable: rejects ${secret:...} too (no refs at all in vars)", () => {
  expect(() => vars.validateTable({ a: "${secret:foo}" })).toThrow(/cannot reference/);
});

test("validateTable: non-object input throws", () => {
  expect(() => vars.validateTable("nope")).toThrow();
  expect(() => vars.validateTable([1, 2, 3])).toThrow();
});
