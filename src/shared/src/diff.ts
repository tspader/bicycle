export type DiffValue = string | number | boolean | string[] | null;

export type Diff = {
  type: string;
  id: string;
  field: string;
  expected: DiffValue;
  actual: DiffValue;
  redacted?: boolean;
};
