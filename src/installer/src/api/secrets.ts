import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { AgeIdentityString } from '../age-key'
import { setIdentity } from '../state'
import type { AppContext } from '../http'

const AgeKeyBody = z.object({ identity: AgeIdentityString })

export const setKey = (c: AppContext) => {
  const parsed = AgeKeyBody.safeParse(c.get('signals') ?? {})
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? 'invalid identity' })
  }
  setIdentity(parsed.data.identity)
  return c.json({ ok: true })
}

export const clearKey = (c: AppContext) => {
  setIdentity(null)
  return c.json({ ok: true })
}
