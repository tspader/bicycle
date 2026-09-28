import { Decrypter, Encrypter } from 'age-encryption'
import { Disk } from '@bicycle/core/disk'

export namespace Fail {
  export type Data = {
    'no-key': { file: string }
    undecryptable: { file: string; key: string }
  }
  export type Kind = keyof Data

  const messages: { [K in Kind]: (data: Data[K]) => string } = {
    'no-key': (d) => `no age identity in ${d.file}`,
    undecryptable: (d) => `${d.file} does not decrypt with ${d.key}`,
  }

  export class Error<K extends Kind = Kind> extends globalThis.Error {
    constructor(
      readonly kind: K,
      readonly data: Data[K],
    ) {
      super((messages[kind] as (data: Data[K]) => string)(data))
      this.name = 'AgeError'
    }
  }
}

export namespace Age {
  const lines = (disk: Disk, file: string): string[] =>
    Disk.text(disk, file)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))

  function decrypter(disk: Disk, key: string): Decrypter {
    const identities = Disk.exists(disk, key) ? lines(disk, key) : []
    if (identities.length === 0) throw new Fail.Error('no-key', { file: key })
    const d = new Decrypter()
    for (const identity of identities) d.addIdentity(identity)
    return d
  }

  export const recipients = (disk: Disk, file: string): string[] => (Disk.exists(disk, file) ? lines(disk, file) : [])

  export async function decrypt(disk: Disk, key: string, file: string): Promise<Uint8Array> {
    const d = decrypter(disk, key)
    const sealed = disk.read(file)
    return d.decrypt(sealed).catch(() => {
      throw new Fail.Error('undecryptable', { file, key })
    })
  }

  export const text = async (disk: Disk, key: string, file: string): Promise<string> =>
    new TextDecoder().decode(await decrypt(disk, key, file))

  export async function encrypt(bytes: Uint8Array, to: string[]): Promise<Uint8Array> {
    const e = new Encrypter()
    for (const recipient of to) e.addRecipient(recipient)
    return e.encrypt(bytes)
  }
}
