import fs from "fs";
import { z } from "zod";
import { DiffSchema, type Diff } from "@bicycle/shared";
import { paths } from "../paths";

export type ScanRecord = {
  detector: string;
  startedAt: string;
  finishedAt: string;
  diffs: Diff[];
};

const ScanRecordSchema = z.object({
  detector: z.string().min(1),
  startedAt: z.string(),
  finishedAt: z.string(),
  diffs: z.array(DiffSchema),
});

export const read = (detector: string): ScanRecord | null => {
  const file = paths.state.scan(detector);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = ScanRecordSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (!parsed.success || parsed.data.detector !== detector) return null;
    return parsed.data;
  } catch {
    return null;
  }
};

export const write = (record: ScanRecord): void => {
  fs.mkdirSync(paths.state.scans, { recursive: true });
  const file = paths.state.scan(record.detector);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n");
  fs.renameSync(tmp, file);
};
