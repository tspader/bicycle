import type { Child } from 'hono/jsx'
import { SudoMode } from '@bicycle/shared'
import { getOpenUser, setOpenUser } from '../ui-state'
import {
  getConfig, getRootHash, setRootHash, getPendingSecrets, getFiles,
  editScalar, editAppend, editDelete, editPrune,
  setFile, deleteFile, stageSecret, unstageSecret,
} from '../state'
import { hashPassword } from '../auth'
import { UsersView } from '../views/users'
import { userPasswordAddr, userPasswordRef, secretRelPath } from '../secrets'
import { type AppContext, parseSignals, requiredQuery } from '../http'
import { renderPage, patchSidecar } from '../render'
import { Api } from './types'

const idxOf = (c: AppContext): number => Number(requiredQuery(c, 'idx'))

const strSig = (c: AppContext, key: string): string => {
  const v = (c.get('signals') as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : ''
}

// First free "user" / "user2" / ... name for a freshly added account.
const uniqueName = (taken: Set<string>): string => {
  if (!taken.has('user')) return 'user'
  let n = 2
  while (taken.has(`user${n}`)) n++
  return `user${n}`
}

// Drop the open pointer if it no longer indexes a real user.
const resolveOpen = (len: number): number | null => {
  const open = getOpenUser()
  if (open == null) return null
  if (open < 0 || open >= len) {
    setOpenUser(null)
    return null
  }
  return open
}

// The Users page body, shared by buildPage (direct nav) and every reload below.
export const usersBody = (): Child => {
  const users = getConfig().users ?? []
  return <UsersView users={users} openIdx={resolveOpen(users.length)} rootSet={getRootHash() != null} />
}

// Move a user's password secret (staged cleartext and/or imported .age file)
// from one address to another so a rename keeps the ref + secret aligned.
const migrateUserSecret = (oldName: string, newName: string): void => {
  const oldAddr = userPasswordAddr(oldName)
  const newAddr = userPasswordAddr(newName)
  const staged = getPendingSecrets().get(oldAddr)
  if (staged !== undefined) {
    stageSecret(newAddr, staged)
    unstageSecret(oldAddr)
  }
  const file = getFiles().get(secretRelPath(oldAddr))
  if (file) {
    setFile(secretRelPath(newAddr), file)
    deleteFile(secretRelPath(oldAddr))
  }
}

const reload = (c: AppContext) => renderPage(c, 'users', usersBody(), '/config/users')

// --- structural changes: full re-render (table + panel) ---------------------

export const add = (c: AppContext) => {
  const users = getConfig().users ?? []
  editAppend(['users'], {
    name: uniqueName(new Set(users.map((u) => u.name))),
    sudo: 'none',
    groups: [],
  })
  setOpenUser(users.length)
  return reload(c)
}

export const open = (c: AppContext) => {
  setOpenUser(idxOf(c))
  return reload(c)
}

export const close = (c: AppContext) => {
  setOpenUser(null)
  return reload(c)
}

export const remove = (c: AppContext) => {
  const idx = idxOf(c)
  const u = (getConfig().users ?? [])[idx]
  if (u) {
    editDelete(['users', idx])
    editPrune(['users'])
    unstageSecret(userPasswordAddr(u.name))
    try { deleteFile(secretRelPath(userPasswordAddr(u.name))) } catch { /* ignore */ }
  }
  setOpenUser(null)
  return reload(c)
}

export const groupAdd = (c: AppContext) => {
  const idx = idxOf(c)
  const u = (getConfig().users ?? [])[idx]
  const g = strSig(c, 'u_new_group').trim()
  if (u && g && !u.groups.includes(g)) editAppend(['users', idx, 'groups'], g)
  return reload(c)
}

export const groupRemove = (c: AppContext) => {
  const idx = idxOf(c)
  const gIdx = Number(requiredQuery(c, 'g'))
  // Leave an empty `groups: []` rather than pruning — the schema requires it.
  if ((getConfig().users ?? [])[idx]?.groups[gIdx] !== undefined) {
    editDelete(['users', idx, 'groups', gIdx])
  }
  return reload(c)
}

// --- inline field autosave: sidecar/preview patch only, no re-render --------

export const name = (c: AppContext) => {
  const idx = idxOf(c)
  const users = getConfig().users ?? []
  const u = users[idx]
  const next = strSig(c, 'u_username').trim()
  // Ignore empty (would break the schema) and duplicate names; keep last valid.
  if (u && next && next !== u.name && !users.some((x, i) => i !== idx && x.name === next)) {
    editScalar(['users', idx, 'name'], next)
    if (u.password) {
      migrateUserSecret(u.name, next)
      editScalar(['users', idx, 'password'], userPasswordRef(next))
    }
  }
  return patchSidecar()
}

export const sudo = (c: AppContext) => {
  const idx = idxOf(c)
  const users = getConfig().users ?? []
  const parsed = SudoMode.safeParse(strSig(c, 'u_sudo'))
  if (users[idx] && parsed.success) editScalar(['users', idx, 'sudo'], parsed.data)
  return patchSidecar()
}

export const password = (c: AppContext) => {
  const idx = idxOf(c)
  const u = (getConfig().users ?? [])[idx]
  const pw = strSig(c, 'u_password')
  // Cleartext is staged (encrypted to age at install); blank leaves it alone.
  if (u && pw) {
    editScalar(['users', idx, 'password'], userPasswordRef(u.name))
    stageSecret(userPasswordAddr(u.name), pw)
  }
  return patchSidecar()
}

export const root = async (c: AppContext) => {
  const { root_password } = parseSignals(c, Api.RootPassword)
  if (root_password) setRootHash(await hashPassword(root_password))
  return patchSidecar()
}
