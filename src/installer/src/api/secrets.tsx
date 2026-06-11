import { AgeIdentityString } from '../age-key'
import { setIdentity } from '../state'
import { type AppContext, type Stream, sse } from '@bicycle/datastar'
import { AgeSection, ageSignals } from '../views/import'
import { patchSidecarInto } from '../render'

const fail = (stream: Stream, error: string): void =>
  stream.signals(ageSignals.patch({ error }))

const applyIdentity = async (stream: Stream, candidate: string): Promise<void> => {
  const parsed = AgeIdentityString.safeParse(candidate.trim())
  if (!parsed.success) {
    fail(stream, parsed.error.issues[0]?.message ?? 'invalid age identity')
    return
  }
  setIdentity(parsed.data)
  stream.html(<AgeSection ageKeySet={true} />, { mode: 'replace' })
  stream.signals(ageSignals.patch({ identity: '', key_file: [], error: '' }))
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
      fail(stream, 'no key file received')
      return
    }
    const text = Buffer.from(file.contents, 'base64').toString('utf-8')
    const identity = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('AGE-SECRET-KEY-'))
    if (!identity) {
      stream.signals(ageSignals.patch({ key_file: [] }))
      fail(stream, `no AGE-SECRET-KEY- line found in ${file.name}`)
      return
    }
    await applyIdentity(stream, identity)
  })
}

export const clearKey = (c: AppContext) =>
  sse(async (stream) => {
    setIdentity(null)
    stream.html(<AgeSection ageKeySet={false} />, { mode: 'replace' })
    stream.signals(ageSignals.patch({ identity: '', key_file: [], error: '' }))
    await patchSidecarInto(stream)
  })
