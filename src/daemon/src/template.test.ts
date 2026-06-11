import { test, expect } from "bun:test";
import { render } from "./template";

type TemplateExpect = {
  text?: string;
  usedSecret?: boolean;
  err?: RegExp;
};

type TemplateCase = {
  name: string;
  tpl: string;
  vars?: unknown;
  secrets?: Record<string, string>;
  expect: TemplateExpect;
};

const THEME = {
  theme: { background: "#1F1F1F", critical: "#d6181b" },
  font: { small: { family: "Iosevka Nerd Font Mono", size: 14 } },
};

const CASES: TemplateCase[] = [
  {
    name: "substitutes nested var paths",
    tpl: 'bg = "{{ theme.background }}"',
    vars: THEME,
    expect: { text: 'bg = "#1F1F1F"' },
  },
  {
    name: "substitutes numbers without quoting",
    tpl: "size = {{ font.small.size }}",
    vars: THEME,
    expect: { text: "size = 14" },
  },
  {
    name: "strip filter removes the # prefix",
    tpl: "{{ theme.background | strip }}",
    vars: THEME,
    expect: { text: "1F1F1F" },
  },
  {
    name: "rgb filter converts hex to space-separated decimal",
    tpl: "{{ theme.background | rgb }}",
    vars: THEME,
    expect: { text: "31 31 31" },
  },
  {
    name: "rgb_comma filter converts hex to comma-separated decimal",
    tpl: "{{ theme.critical | rgb_comma }}",
    vars: THEME,
    expect: { text: "214,24,27" },
  },
  {
    name: "for loops iterate array vars",
    tpl: "{% for h in hosts %}[{{ h }}]{% endfor %}",
    vars: { hosts: ["a", "b", "c"] },
    expect: { text: "[a][b][c]" },
  },
  {
    name: "secret filter resolves and reports taint",
    tpl: 'password = "{{ "svc/db" | secret }}"',
    secrets: { "svc/db": "hunter2" },
    expect: { text: 'password = "hunter2"', usedSecret: true },
  },
  {
    name: "untemplated render reports no taint",
    tpl: "static",
    expect: { text: "static", usedSecret: false },
  },
  {
    name: "shell syntax passes through untouched",
    tpl: 'export PS1="${PS1}" $HOME ${not_a_liquid_var}',
    expect: { text: 'export PS1="${PS1}" $HOME ${not_a_liquid_var}' },
  },
  {
    name: "undefined variable fails the render",
    tpl: "{{ nope.missing }}",
    vars: THEME,
    expect: { err: /undefined variable/ },
  },
  {
    name: "undefined filter fails the render",
    tpl: "{{ theme.background | nofilter }}",
    vars: THEME,
    expect: { err: /undefined filter/ },
  },
  {
    name: "unknown secret address fails the render",
    tpl: '{{ "svc/missing" | secret }}',
    secrets: {},
    expect: { err: /unknown secret/ },
  },
];

const runTemplateCase = async (c: TemplateCase): Promise<void> => {
  const resolveSecret = async (addr: string): Promise<string> => {
    const v = c.secrets?.[addr];
    if (v === undefined) throw new Error(`unknown secret: ${addr}`);
    return v;
  };
  const attempt = render(c.tpl, c.vars ?? {}, resolveSecret);
  if (c.expect.err) {
    expect(attempt).rejects.toThrow(c.expect.err);
    return;
  }
  const r = await attempt;
  if (c.expect.text !== undefined) expect(r.text).toBe(c.expect.text);
  if (c.expect.usedSecret !== undefined) expect(r.usedSecret).toBe(c.expect.usedSecret);
};

for (const c of CASES) {
  test(c.name, () => runTemplateCase(c));
}
