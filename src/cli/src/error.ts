export namespace Fail {
  export type Data = {
    invalid: { reason: string }
  }
  export type Kind = keyof Data

  const messages: { [K in Kind]: (data: Data[K]) => string } = {
    invalid: (d) => d.reason,
  }

  export class Error<K extends Kind = Kind> extends globalThis.Error {
    constructor(
      readonly kind: K,
      readonly data: Data[K],
    ) {
      super((messages[kind] as (data: Data[K]) => string)(data))
      this.name = 'CliError'
    }
  }
}
