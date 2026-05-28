// A `${secret:addr}` reference, e.g. ${secret:users/spader/password}.
export const SECRET_REF = /^\$\{secret:([^}]+)\}$/

export const userPasswordAddr = (name: string): string => `users/${name}/password`
export const userPasswordRef = (name: string): string => `\${secret:${userPasswordAddr(name)}}`

// Map a secret address ("users/spader/password") to its path inside the config
// tree: secrets/<addr>.age. Mirrors the daemon's paths.etc.secret() convention,
// including an escape guard — an imported bicycle.yml is untrusted, so a ref
// like ${secret:../../etc/shadow} must not point outside secrets/.
export const secretRelPath = (addr: string): string => {
  const trimmed = addr.trim()
  if (!trimmed) throw new Error('empty secret address')
  if (trimmed.startsWith('/')) throw new Error(`secret address must be relative: ${addr}`)
  const parts = trimmed.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new Error(`secret address escapes secrets root: ${addr}`)
  }
  return `secrets/${trimmed}.age`
}
