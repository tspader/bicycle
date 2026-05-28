import { Decrypter, Encrypter, generateIdentity, identityToRecipient } from 'age-encryption'

// Installer-side age helpers. The daemon has an equivalent module that reads
// its identity from a key file; here the identity is held in memory (pasted
// or auto-loaded from an imported tree), so we take it as a string.

export const decryptText = async (bytes: Uint8Array, identity: string): Promise<string> => {
  const d = new Decrypter()
  d.addIdentity(identity.trim())
  return d.decrypt(bytes, 'text')
}

export const encrypt = async (text: string, recipients: string[]): Promise<Uint8Array> => {
  const e = new Encrypter()
  for (const r of recipients) e.addRecipient(r.trim())
  return e.encrypt(new TextEncoder().encode(text))
}

// Derive the public recipient ("age1...") for an identity, so secrets we write
// can be decrypted by the matching age.key on the installed system.
export const recipientFor = (identity: string): Promise<string> =>
  identityToRecipient(identity.trim())

// Generate a fresh native age identity ("AGE-SECRET-KEY-1..."). Used when a UI
// build has passwords to persist but no identity has been set yet.
export const generate = (): Promise<string> => generateIdentity()
