import type { Child } from 'hono/jsx'
import { getOpenUser, setOpenUser } from '../ui-state'
import {
  getConfig, getRootHash, setRootHash, getPendingSecrets, getFiles,
  editScalar, editAppend, editDelete, editPrune,
  setFile, deleteFile, stageSecret, unstageSecret,
} from '../state'
import { hashPassword } from '../auth'
import { UsersView, userPanelSignals, rootSignals } from '../views/users'
import { userPasswordAddr, userPasswordRef, secretRelPath } from '../secrets'
import type { AppContext } from '../http'
import { routes } from '../routes'
import { renderPage, patchSidecar } from '../render'

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
  setOpenUser(routes.usersOpen.params(c).idx)
  return reload(c)
}

export const close = (c: AppContext) => {
  setOpenUser(null)
  return reload(c)
}

export const remove = (c: AppContext) => {
  const { idx } = routes.usersDelete.params(c)
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
  const { idx } = routes.usersGroupAdd.params(c)
  const u = (getConfig().users ?? [])[idx]
  const g = userPanelSignals.read(c).new_group.trim()
  if (u && g && !u.groups.includes(g)) editAppend(['users', idx, 'groups'], g)
  return reload(c)
}

export const groupRemove = (c: AppContext) => {
  const { idx, g } = routes.usersGroupRemove.params(c)
  // Leave an empty `groups: []` rather than pruning — the schema requires it.
  if ((getConfig().users ?? [])[idx]?.groups[g] !== undefined) {
    editDelete(['users', idx, 'groups', g])
  }
  return reload(c)
}

// --- inline field autosave: sidecar/preview patch only, no re-render --------

export const name = (c: AppContext) => {
  const { idx } = routes.usersName.params(c)
  const users = getConfig().users ?? []
  const u = users[idx]
  const next = userPanelSignals.read(c).username.trim()
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
  const { idx } = routes.usersSudo.params(c)
  const mode = userPanelSignals.read(c).sudo
  if ((getConfig().users ?? [])[idx]) editScalar(['users', idx, 'sudo'], mode)
  return patchSidecar()
}

export const password = (c: AppContext) => {
  const { idx } = routes.usersPassword.params(c)
  const u = (getConfig().users ?? [])[idx]
  const pw = userPanelSignals.read(c).password
  // Cleartext is staged (encrypted to age at install); blank leaves it alone.
  if (u && pw) {
    editScalar(['users', idx, 'password'], userPasswordRef(u.name))
    stageSecret(userPasswordAddr(u.name), pw)
  }
  return patchSidecar()
}

export const root = async (c: AppContext) => {
  const { root_password } = rootSignals.read(c)
  if (root_password) setRootHash(await hashPassword(root_password))
  return patchSidecar()
}
