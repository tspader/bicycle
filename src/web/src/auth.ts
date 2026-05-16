declare const Bun: { spawn: (args: string[], opts: Record<string, unknown>) => { stdin: { write: (b: Uint8Array) => Promise<number>; end: () => void }; stdout: ReadableStream<Uint8Array>; exited: Promise<number> } }

export const hashPassword = async (plaintext: string): Promise<string> => {
  const proc = Bun.spawn(['openssl', 'passwd', '-6', '-stdin'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
  })
  await proc.stdin.write(new TextEncoder().encode(plaintext + '\n'))
  proc.stdin.end()
  const out = (await new Response(proc.stdout).text()).trim()
  await proc.exited
  if (!out.startsWith('$')) throw new Error('hash failed')
  return out
}
