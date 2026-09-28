import { consola } from 'consola'

export namespace Sys {
  export type Host = {
    print: (text: string) => void
    status: (text: string) => void
    fail: (error: unknown) => void
    exit: (code: number) => void
    input: () => Promise<Uint8Array>
  }

  export function real(): Host {
    return {
      print: (text) => consola.log(text),
      status: (text) => {
        if (process.stderr.isTTY) process.stderr.write(`\r\x1b[2K${text}`)
      },
      fail: (error) => {
        consola.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
      },
      exit: (code) => {
        process.exitCode = code
      },
      input: async () => {
        if (process.stdin.isTTY) process.stderr.write('reading from stdin; end with Ctrl+D\n')
        return Bun.stdin.bytes()
      },
    }
  }
}
