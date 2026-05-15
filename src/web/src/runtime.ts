declare const Bun: any
declare const tjs: any

export const isTjs = typeof (globalThis as any).tjs !== 'undefined'

type Env = Record<string, string | undefined>

export const env: Env = isTjs ? { ...tjs.env } : { ...process.env }

export type SpawnOptions = {
  stdout?: 'pipe' | 'inherit' | 'ignore'
  stderr?: 'pipe' | 'inherit' | 'ignore'
  env?: Env
}

export type SpawnResult = {
  stdout: ReadableStream<Uint8Array> | null
  stderr: ReadableStream<Uint8Array> | null
  exited: Promise<number>
}

export function spawn(args: string[], opts: SpawnOptions = {}): SpawnResult {
  if (isTjs) {
    const proc = tjs.spawn(args, opts)
    return {
      stdout: proc.stdout ?? null,
      stderr: proc.stderr ?? null,
      exited: proc.wait().then((s: any) => s.exit_status ?? 0),
    }
  }
  const proc = Bun.spawn(args, opts)
  return {
    stdout: proc.stdout ?? null,
    stderr: proc.stderr ?? null,
    exited: proc.exited,
  }
}

export type ServeOptions = {
  port: number
  fetch: (req: Request) => Response | Promise<Response>
}

export function serve(opts: ServeOptions): unknown {
  return isTjs ? tjs.serve(opts) : Bun.serve(opts)
}

export async function readFile(path: string): Promise<Uint8Array> {
  if (isTjs) return await tjs.readFile(path)
  return new Uint8Array(await Bun.file(path).arrayBuffer())
}
