const OPEN = "# bicycle";
const CLOSE = "# /bicycle";

export const block = (names: string[]): string => {
  if (names.length === 0) return "";
  const entries = [...names].sort().map((n) => `127.0.0.1 ${n}\n`);
  return `${OPEN}\n${entries.join("")}${CLOSE}\n`;
};

export const splice = (existing: string, block: string): string => {
  const lines = existing.split("\n");
  const open = lines.indexOf(OPEN);
  if (open === -1) {
    const sep = existing !== "" && !existing.endsWith("\n") && block !== "" ? "\n" : "";
    return `${existing}${sep}${block}`;
  }
  const close = lines.indexOf(CLOSE, open);
  const before = lines.slice(0, open).map((l) => `${l}\n`).join("");
  const after = close === -1 ? "" : lines.slice(close + 1).join("\n");
  return `${before}${block}${after}`;
};
