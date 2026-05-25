// Slug for device paths and other identifier-like strings used as Datastar
// signal-name prefixes. Server and view must agree on this exactly because
// the view defines signals and the server reads them back by name.
export const sigSlug = (s: string): string =>
  s.replace(/[^a-z0-9]/gi, '_').replace(/^_+/, '')
