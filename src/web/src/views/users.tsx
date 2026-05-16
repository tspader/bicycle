import { Layout, Page, Field } from './layout'
import type { User } from '../config'

export type UserRow = { kind: 'root' | 'user'; username: string; sudo: boolean; groups: string[]; has_password: boolean }

type Props = {
  rows: UserRow[]
  editing: UserRow | null
}

export const UsersView = ({ rows, editing }: Props) => {
  const init = editing ?? { kind: 'user' as const, username: '', sudo: false, groups: [] as string[], has_password: false }
  const signals = {
    kind: init.kind,
    username: init.username,
    sudo: init.sudo,
    groups: init.groups.join(', '),
    password: '',
  }
  const formAttrs: Record<string, string> = {
    'data-signals': JSON.stringify(signals),
  }
  return (
    <Layout active="users">
      <Page heading="Users" subhead="Root password and additional user accounts.">
        <UserForm attrs={formAttrs} isRoot={init.kind === 'root'} editing={editing !== null} />
        <UsersTable rows={rows} />
      </Page>
    </Layout>
  )
}

const UserForm = ({ attrs, isRoot, editing }: { attrs: Record<string, string>; isRoot: boolean; editing: boolean }) => (
  <form id="user-form" class="form card" {...attrs}>
    <h2 class="card-title" data-text={'$kind === "root" ? "root" : ($username || "new user")'} />
    <Field label="Username" htmlFor="username">
      <input
        id="username"
        class="combo"
        type="text"
        data-bind="username"
        data-attr-disabled="$kind === 'root'"
        disabled={isRoot}
        value={isRoot ? 'root' : ''}
      />
    </Field>
    <Field label="Password" htmlFor="password" hint={editing ? 'Leave blank to keep existing.' : ''}>
      <input id="password" class="combo" type="password" data-bind="password" placeholder="••••••" />
    </Field>
    <Field label="Sudo" htmlFor="sudo">
      <label class="toggle">
        <input
          id="sudo"
          type="checkbox"
          data-bind="sudo"
          data-attr-disabled="$kind === 'root'"
          disabled={isRoot}
        />
        <span data-text="$sudo ? 'On' : 'Off'" />
      </label>
    </Field>
    <Field label="Groups" htmlFor="groups" hint="Comma-separated.">
      <input
        id="groups"
        class="combo"
        type="text"
        data-bind="groups"
        data-attr-disabled="$kind === 'root'"
        disabled={isRoot}
        placeholder="wheel, video"
      />
    </Field>
    <div class="form-actions">
      <button type="button" class="btn" data-on-click="@post('/api/users/save')">
        Save
      </button>
      <a class="btn-link" href="/config/users">
        Reset
      </a>
    </div>
  </form>
)

const UsersTable = ({ rows }: { rows: UserRow[] }) => (
  <table id="users-table" class="table">
    <thead>
      <tr>
        <th>User</th>
        <th>Sudo</th>
        <th>Groups</th>
        <th>Password</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {rows.map((r) => (
        <tr class="row" key={r.username}>
          <td>
            <a class="link" href={`/config/users?edit=${encodeURIComponent(r.username)}`}>
              {r.username}
            </a>
          </td>
          <td>{r.sudo ? 'yes' : ''}</td>
          <td>{r.groups.join(', ')}</td>
          <td>{r.has_password ? 'set' : '—'}</td>
          <td>
            {r.kind === 'user' ? (
              <button
                type="button"
                class="btn-danger"
                data-on-click={`@post('/api/users/delete?name=${encodeURIComponent(r.username)}')`}
              >
                Delete
              </button>
            ) : null}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
)

export const toRows = (users: User[] | undefined, rootSet: boolean): UserRow[] => {
  const out: UserRow[] = [{ kind: 'root', username: 'root', sudo: true, groups: [], has_password: rootSet }]
  for (const u of users ?? []) {
    out.push({ kind: 'user', username: u.username, sudo: u.sudo, groups: u.groups, has_password: u.enc_password !== null })
  }
  return out
}
