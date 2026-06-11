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
      <UsersTable users={users} openIdx={openIdx} />
      {open ? <UserPanel user={open} idx={openIdx!} /> : null}
      <RootSection rootSet={rootSet} />
    </Page>
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
      {users.map((u, i) => {
        // Re-clicking the open row closes it, mirroring the Disk table.
        const click = i === openIdx ? routes.usersClose.action() : routes.usersOpen.action({ idx: i })
        return (
          <tr class={`row${i === openIdx ? ' row-selected' : ''}`} {...on('click', click)}>
            <td class="mono">{u.name}</td>
            <td class="col-sudo muted">{u.sudo}</td>
            <td class="muted small">{u.groups.length ? u.groups.join(', ') : '—'}</td>
            <td class="col-pw muted">{u.password ? '✓' : '—'}</td>
          </tr>
        )
      })}
      <tr class="row users-add-row" {...on('click', routes.usersAdd.action())}>
        <td colspan={4}>+ Add user</td>
      </tr>
    </tbody>
  </table>
)

const UserPanel = ({ user, idx }: { user: User; idx: number }) => {
  const $ = userPanelSignals.$
  // @post serializes signals synchronously (capturing u_new_group), so clearing
  // it right after is safe and resets the input for the next entry.
  const addGroup = seq(routes.usersGroupAdd.action({ idx }), $.new_group.set(''))
  return (
    <Section title="Edit user">
      <form
        class="form card account-card"
        {...userPanelSignals.seed({ username: user.name, password: '', sudo: user.sudo, new_group: '' })}
      >
        <div class="card-header">
          <h2 class="card-title" {...text(expr`${$.username} || 'user'`)} />
          <button
            type="button"
            class="btn btn-danger"
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
            {...on('input', routes.usersName.action({ idx }), { debounceMs: 400 })}
          />
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
          <div class="chips">
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
    </Section>
  )
}

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
    </form>
  </Section>
)
