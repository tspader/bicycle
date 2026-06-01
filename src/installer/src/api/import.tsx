import type { Child } from 'hono/jsx'
import { ImportView } from '../views/import'
import { getIdentity } from '../state'

export const importBody = (): Child => <ImportView ageKeySet={getIdentity() != null} />
