import type { Diff, DiffValue } from "@bicycle/shared";

const SHA256_HEX = /^[0-9a-f]{64}$/;

export const ago = (iso: string): string => {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (60 * 24))}d ago`;
};

export const fmt = (v: DiffValue): string => {
  if (v === null) return "<none>";
  if (Array.isArray(v)) return v.join(",");
  if (typeof v === "string" && SHA256_HEX.test(v)) return `sha256:${v.slice(0, 12)}`;
  return String(v);
};

export const line = (d: Diff): string => {
  const red = d.redacted ? " (redacted)" : "";
  if (d.expected === null) return `+ ${d.type} ${d.id} ${d.field}: ${fmt(d.actual)}${red}`;
  if (d.actual === null) return `- ${d.type} ${d.id} ${d.field}: ${fmt(d.expected)}${red}`;
  return `~ ${d.type} ${d.id} ${d.field}: ${fmt(d.actual)} -> ${fmt(d.expected)}${red}`;
};
