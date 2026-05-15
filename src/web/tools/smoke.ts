import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 8090
const BASE = `http://localhost:${PORT}`

const proc = spawn('bun', ['run', 'src/server.tsx'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
proc.stdout.on('data', () => {})
proc.stderr.on('data', (d) => process.stderr.write(d))

const cleanup = () => {
  proc.kill('SIGTERM')
}
process.on('exit', cleanup)
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/config/locale`)
      if (res.ok) return
    } catch {}
    await sleep(100)
  }
  throw new Error('server did not start')
}

async function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${JSON.stringify(actual)}`)
  if (!ok) {
    console.log(`        expected=${JSON.stringify(expected)}`)
    process.exitCode = 1
  }
}

async function findSelected(path: string): Promise<string[]> {
  const html = await (await fetch(`${BASE}${path}`)).text()
  return [...html.matchAll(/<option value="([^"]+)" selected/g)].map((m) => m[1]!)
}

await waitReady()

await fetch(`${BASE}/api/locale`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kbLayout: 'us', sysLang: 'en_US.UTF-8', sysEnc: 'UTF-8' }),
})
await expect('locale defaults', await findSelected('/config/locale'), [
  'us',
  'en_US.UTF-8',
  'UTF-8',
])

const r1 = await fetch(`${BASE}/api/locale`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kbLayout: 'azerty', sysLang: 'fr_FR.UTF-8', sysEnc: 'UTF-8' }),
})
await expect('locale POST status', r1.status, 204)
await expect('locale after POST', await findSelected('/config/locale'), [
  'azerty',
  'fr_FR.UTF-8',
  'UTF-8',
])

const r2 = await fetch(`${BASE}/api/locale`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kbLayout: '', sysLang: 'fr_FR.UTF-8', sysEnc: 'UTF-8' }),
})
await expect('locale rejects empty', r2.status, 400)

const r3 = await fetch(`${BASE}/api/kernels`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kernel: 'linux-zen' }),
})
await expect('kernels POST status', r3.status, 204)
await expect('kernels after POST', await findSelected('/config/kernels'), ['linux-zen'])

const r4 = await fetch(`${BASE}/api/kernels`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kernel: 'linux-bogus' }),
})
await expect('kernels rejects unknown', r4.status, 400)

const stub = await fetch(`${BASE}/config/disk`)
const stubHtml = await stub.text()
await expect('stub renders', stubHtml.includes('Not yet implemented.'), true)

cleanup()
