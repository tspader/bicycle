export interface Net {
  fetch: (url: string, ask: Net.Ask) => Promise<Response>
}

export namespace Net {
  export type Ask = { method: string; headers?: Record<string, string>; body?: string | Uint8Array }

  export const real = (): Net => ({
    fetch: (url, ask) => fetch(url, ask),
  })
}
