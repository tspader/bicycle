import type { Document } from 'yaml'
import type { BicycleConfig } from '@bicycle/shared'
import type { TreeFile } from './import-tree'
import * as doc from './doc'

export type ConfigTree = {
  text: string
  files: Map<string, TreeFile>
  identity: string | null
}

const DEFAULT_CONFIG = `core:
  hostname: bicycle
  timezone: UTC
  kernels: [linux]
  ntp: true
locale:
  keyboard: us
  language: en_US.UTF-8
  encoding: UTF-8
boot:
  loader: systemd-boot
  uki: true
  removable: false
swap:
  enabled: true
  algorithm: zstd
network:
  mode: iso
`

let text = DEFAULT_CONFIG
let files = new Map<string, TreeFile>()
let identity: string | null = null

// archinstall-only credentials. These are NOT part of bicycle.yml (the daemon
// never manages root or the LUKS passphrase) — they're carved into the --creds
// file at install time and otherwise held only in memory.
let rootHash: string | null = null
let encryptionPassword: string | null = null

// Cleartext secrets entered in the UI (keyed by secret address, e.g.
// "users/spader/password"), staged in memory until install encrypts them to
// the resolved recipients and writes <addr>.age into the tree. Imported users
// already carry their .age files in `files`, so this only covers UI input.
const pendingSecrets = new Map<string, string>()

export const getText = (): string => text
export const getConfig = (): BicycleConfig => doc.resolved(text)
export const getFiles = (): ReadonlyMap<string, TreeFile> => files
export const getIdentity = (): string | null => identity
export const getRootHash = (): string | null => rootHash
export const getEncryptionPassword = (): string | null => encryptionPassword
export const getPendingSecrets = (): ReadonlyMap<string, string> => pendingSecrets

// Replace the whole tree (an import). Adopts an age identity if the import
// carried one; otherwise leaves any previously-set identity untouched. Staged
// UI secrets belong to the prior config, so they're dropped.
export const loadTree = (next: {
  text: string
  files: Map<string, TreeFile>
  identity?: string | null
}): void => {
  text = next.text
  files = next.files
  if (next.identity) identity = next.identity
  pendingSecrets.clear()
}

export const editDoc = (fn: (d: Document) => void): void => {
  text = doc.edit(text, fn)
}
export const editScalar = (path: doc.Path, value: string | number | boolean): void => {
  text = doc.setScalar(text, path, value)
}
export const editNode = (path: doc.Path, value: Parameters<typeof doc.setNode>[2]): void => {
  text = doc.setNode(text, path, value)
}
export const editDelete = (path: doc.Path): void => {
  text = doc.deleteAt(text, path)
}
export const editAppend = (path: doc.Path, value: Parameters<typeof doc.append>[2]): void => {
  text = doc.append(text, path, value)
}
export const editPrune = (path: doc.Path): void => {
  text = doc.pruneEmpty(text, path)
}

export const setIdentity = (next: string | null): void => {
  identity = next
}
export const setRootHash = (next: string | null): void => {
  rootHash = next
}
export const setEncryptionPassword = (next: string | null): void => {
  encryptionPassword = next
}

export const setFile = (path: string, file: TreeFile): void => {
  files.set(path, file)
}
export const deleteFile = (path: string): void => {
  files.delete(path)
}

export const stageSecret = (addr: string, clear: string): void => {
  pendingSecrets.set(addr, clear)
}
export const unstageSecret = (addr: string): void => {
  pendingSecrets.delete(addr)
}
