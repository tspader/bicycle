import { z } from 'zod'
import { Page, Section, Field } from './layout'
import { SudoMode, type User } from '@bicycle/shared'
import { bind, expr, on, seq, signals, text } from '@bicycle/datastar'
import { routes } from '../routes'

export const userPanelSignals = signals(
  {
    username: z.string().default(''),
    password: z.string().default(''),
    sudo: SudoMode,
    new_group: z.string().default(''),
  },
  'u_',
)

export const rootSignals = signals({
  root_password: z.string(),
})

type Props = {
  users: User[]
  openIdx: number | null
  rootSet: boolean
}

const SUDO_OPTIONS = SudoMode.options

export const UsersView = ({ users, openIdx, rootSet }: Props) => {
  const open = openIdx != null ? users[openIdx] ?? null : null
  return (
    <Page heading="Users" subhead="Add accounts and edit them inline. Changes save as you type.">
      <Section title="Accounts">
        <div class="card table-card account-card">
          <UsersTable users={users} openIdx={openIdx} />
          <div class="table-card-footer">
            <button id="add-user" type="button" class="btn" {...on('click', routes.usersAdd.action())}>
              + Add user
            </button>
          </div>
        </div>
        {open ? <UserPanel user={open} idx={openIdx!} /> : null}
      </Section>
      <RootSection rootSet={rootSet} />
    </Page>
  )
}

export const UserRow = ({ u, idx, isOpen }: { u: User; idx: number; isOpen: boolean }) => {
  // Re-clicking the open row closes it, mirroring the Disk table.
  const click = isOpen ? routes.usersClose.action() : routes.usersOpen.action({ idx })
  return (
    <tr id={`user-row-${idx}`} class={`row${isOpen ? ' row-selected' : ''}`} {...on('click', click)}>
      <td class="mono">{u.name}</td>
      <td class="col-sudo muted">{u.sudo}</td>
      <td class="muted small">{u.groups.length ? u.groups.join(', ') : '—'}</td>
      <td class="col-pw muted">{u.password ? '✓' : '—'}</td>
    </tr>
  )
}

const UsersTable = ({ users, openIdx }: { users: User[]; openIdx: number | null }) => (
  <table class="table users-table">
    <thead>
      <tr>
        <th>Username</th>
        <th class="col-sudo">Sudo</th>
        <th>Groups</th>
        <th class="col-pw">Password</th>
      </tr>
    </thead>
    <tbody>
      {users.length === 0 ? (
        <tr>
          <td colspan={4} class="table-empty">No accounts yet.</td>
        </tr>
      ) : (
        users.map((u, i) => <UserRow u={u} idx={i} isOpen={i === openIdx} />)
      )}
    </tbody>
  </table>
)

export const NameStatus = ({ status }: { status: string }) => (
  <p id="user-name-status" class="field-msg warn small">{status}</p>
)

export const GroupChips = ({ user, idx }: { user: User; idx: number }) => (
  <div class="chips" id={`user-groups-${idx}`}>
    {user.groups.length === 0 ? <span class="muted small">No extra groups.</span> : null}
    {user.groups.map((g, gi) => (
      <span class="chip">
        {g}
        <button
          type="button"
          class="chip-x"
          title={`Remove ${g}`}
          {...on('click', routes.usersGroupRemove.action({ idx, g: gi }))}
        >
          ×
        </button>
      </span>
    ))}
  </div>
)

const UserPanel = ({ user, idx }: { user: User; idx: number }) => {
  const $ = userPanelSignals.$
  // @post serializes signals synchronously (capturing u_new_group), so clearing
  // it right after is safe and resets the input for the next entry.
  const addGroup = seq(routes.usersGroupAdd.action({ idx }), $.new_group.set(''))
  return (
    <form
      class="form card account-card"
      {...userPanelSignals.seed({ username: user.name, password: '', sudo: user.sudo, new_group: '' })}
    >
      <div class="card-header">
        <h2 class="card-title" {...text(expr`${$.username} || 'user'`)} />
        <button
          id="user-remove"
          type="button"
          class="btn btn-danger btn-sm"
          {...on('click', routes.usersDelete.action({ idx }))}
        >
          Remove
        </button>
      </div>
      <Field label="Username" htmlFor="u-name">
        <input
          id="u-name"
          class="combo"
          type="text"
          {...bind($.username)}
          {...on('input', routes.usersName.action({ idx }), { debounceMs: 100 })}
        />
        <NameStatus status="" />
      </Field>
      <Field label="Password" htmlFor="u-pw">
        <input
          id="u-pw"
          class="combo"
          type="password"
          placeholder={user.password ? '•••••• (set; leave blank to keep)' : '••••••'}
          {...bind($.password)}
          {...on('input', routes.usersPassword.action({ idx }), { debounceMs: 400 })}
        />
      </Field>
      <Field label="Sudo" htmlFor="u-sudo">
        <select
          id="u-sudo"
          class="combo"
          {...bind($.sudo)}
          {...on('change', routes.usersSudo.action({ idx }))}
        >
          {SUDO_OPTIONS.map((o) => (
            <option value={o} selected={o === user.sudo}>{o}</option>
          ))}
        </select>
      </Field>
      <Field label="Groups">
        <GroupChips user={user} idx={idx} />
        <div class="chip-row chip-row-tight">
          <input
            class="chip-input"
            type="text"
            placeholder="add group…"
            {...bind($.new_group)}
            {...on('keydown', expr`evt.key === 'Enter' && (evt.preventDefault(), ${addGroup})`)}
          />
          <button type="button" class="btn btn-sm" {...on('click', addGroup)}>
            Add
          </button>
        </div>
      </Field>
    </form>
  )
}

export const RootStatus = ({ rootSet }: { rootSet: boolean }) => (
  <p id="root-status" class="muted small">
    {rootSet ? '✓ root password set' : 'No root password set.'}
  </p>
)

const RootSection = ({ rootSet }: { rootSet: boolean }) => (
  <Section title="Root" subhead="Set the root account password.">
    <form class="form card account-card" {...rootSignals.seed({ root_password: '' })}>
      <Field label="Password" htmlFor="root-pw">
        <input
          id="root-pw"
          class="combo"
          type="password"
          placeholder={rootSet ? '•••••• (set; leave blank to keep)' : '••••••'}
          {...bind(rootSignals.$.root_password)}
          {...on('input', routes.usersRoot.action(), { debounceMs: 400 })}
        />
      </Field>
      <RootStatus rootSet={rootSet} />
    </form>
  </Section>
)
