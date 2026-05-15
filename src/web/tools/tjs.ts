import { $ } from "bun";

await $`./tools/tjs bundle src/server.tsx dist/bicycle.bundle.js --loader:.css=text --loader:.lib=text`
await $`./tools/tjs compile dist/bicycle.bundle.js dist/bicycle`

