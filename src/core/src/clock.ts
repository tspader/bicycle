export interface Clock {
  now: () => Date
  after: (ms: number, run: () => void) => Clock.Cancel
}

export namespace Clock {
  export type Cancel = () => void

  export const real = (): Clock => ({
    now: () => new Date(),
    after: (ms, run) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
  })

  export const sleep = (clock: Clock, ms: number): Promise<void> =>
    new Promise((done) => {
      clock.after(ms, done)
    })
}
