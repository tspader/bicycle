import { Page, Section, Field } from './layout'
import { SudoMode, type User } from '@bicycle/shared'

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
        const isOpen = i === openIdx
        // Re-clicking the open row closes it, mirroring the Disk table.
        const clickUrl = isOpen ? '/api/users/close' : `/api/users/open?idx=${i}`
        return (
          <tr
            class={`row${isOpen ? ' row-selected' : ''}`}
            data-on:click={`@post('${clickUrl}')`}
          >
            <td class="mono">{u.name}</td>
            <td class="col-sudo muted">{u.sudo}</td>
            <td class="muted small">{u.groups.length ? u.groups.join(', ') : '—'}</td>
            <td class="col-pw muted">{u.password ? '✓' : '—'}</td>
          </tr>
        )
      })}
      <tr class="row users-add-row" data-on:click="@post('/api/users/add')">
        <td colspan={4}>+ Add user</td>
      </tr>
    </tbody>
  </table>
)

const UserPanel = ({ user, idx }: { user: User; idx: number }) => {
  // Fixed signal names: only one panel is open at a time. data-signals re-seeds
  // them on every open/structural render.
  const signals = {
    u_username: user.name,
    u_password: '',
    u_sudo: user.sudo,
    u_new_group: '',
  }
  const q = `idx=${idx}`
  // @post serializes signals synchronously (capturing u_new_group), so clearing
  // it right after is safe and resets the input for the next entry.
  const addGroup = `@post('/api/users/group/add?${q}'); $u_new_group = ''`
  return (
    <Section title="Edit user">
      <form class="form card account-card" data-signals={JSON.stringify(signals)}>
        <div class="card-header">
          <h2 class="card-title" data-text="$u_username || 'user'" />
          <button
            type="button"
            class="btn btn-danger"
            data-on:click={`@post('/api/users/delete?${q}')`}
          >
            Remove
          </button>
        </div>
        <Field label="Username" htmlFor="u-name">
          <input
            id="u-name"
            class="combo"
            type="text"
            data-bind="u_username"
            {...{ 'data-on:input__debounce.400ms': `@post('/api/users/name?${q}')` }}
          />
        </Field>
        <Field label="Password" htmlFor="u-pw">
          <input
            id="u-pw"
            class="combo"
            type="password"
            data-bind="u_password"
            placeholder={user.password ? '•••••• (set; leave blank to keep)' : '••••••'}
            {...{ 'data-on:input__debounce.400ms': `@post('/api/users/password?${q}')` }}
          />
        </Field>
        <Field label="Sudo" htmlFor="u-sudo">
          <select
            id="u-sudo"
            class="combo"
            data-bind="u_sudo"
            data-on:change={`@post('/api/users/sudo?${q}')`}
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
                  data-on:click={`@post('/api/users/group/remove?${q}&g=${gi}')`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              class="chip-input"
              type="text"
              placeholder="add group…"
              data-bind="u_new_group"
              data-on:keydown={`evt.key === 'Enter' && (evt.preventDefault(), ${addGroup})`}
            />
            <button type="button" class="btn btn-sm" data-on:click={addGroup}>
              Add
            </button>
          </div>
        </Field>
      </form>
    </Section>
  )
}

const RootSection = ({ rootSet }: { rootSet: boolean }) => {
  const signals = { root_password: '' }
  return (
    <Section title="Root" subhead="Set the root account password.">
      <form class="form card account-card" data-signals={JSON.stringify(signals)}>
        <Field label="Password" htmlFor="root-pw">
          <input
            id="root-pw"
            class="combo"
            type="password"
            data-bind="root_password"
            placeholder={rootSet ? '•••••• (set; leave blank to keep)' : '••••••'}
            {...{ 'data-on:input__debounce.400ms': "@post('/api/users/root')" }}
          />
        </Field>
      </form>
    </Section>
  )
}
