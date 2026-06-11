import { AgeIdentityString } from '../age-key'
import { setIdentity } from '../state'
import type { AppContext } from '../http'
import { AgeSection, ageSignals, importStatusSignals } from '../views/import'
import { type Stream, sse, patchSidecarInto } from '../render'

const announce = (stream: Stream, status: string, error: string): void =>
  stream.signals(importStatusSignals.patch({ status, error }))

const applyIdentity = async (stream: Stream, candidate: string): Promise<void> => {
  const parsed = AgeIdentityString.safeParse(candidate.trim())
  if (!parsed.success) {
    announce(stream, '', parsed.error.issues[0]?.message ?? 'invalid age identity')
    return
  }
  setIdentity(parsed.data)
  stream.signals(ageSignals.patch({ identity: '', key_file: [] }))
  stream.html(<AgeSection ageKeySet={true} />, { mode: 'replace' })
  announce(stream, 'Age identity set.', '')
  await patchSidecarInto(stream)
}

export const setKey = (c: AppContext) => {
  const { identity } = ageSignals.read(c)
  return sse((stream) => applyIdentity(stream, identity))
}

export const setKeyFile = (c: AppContext) => {
  const { key_file } = ageSignals.read(c)
  return sse(async (stream) => {
    const file = key_file[0]
    if (!file) {
      announce(stream, '', 'no key file received')
      return
    }
    const text = Buffer.from(file.contents, 'base64').toString('utf-8')
    const identity = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('AGE-SECRET-KEY-'))
    if (!identity) {
      stream.signals(ageSignals.patch({ key_file: [] }))
      announce(stream, '', `no AGE-SECRET-KEY- line found in ${file.name}`)
      return
    }
    await applyIdentity(stream, identity)
  })
}

export const clearKey = (c: AppContext) =>
  sse(async (stream) => {
    setIdentity(null)
    stream.html(<AgeSection ageKeySet={false} />, { mode: 'replace' })
    announce(stream, 'Age identity cleared.', '')
    await patchSidecarInto(stream)
  })
