import { Page, Field } from './layout'
import type { User } from '../config'

type Props = { rootSet: boolean; users: User[] }

export const UsersView = ({ rootSet, users }: Props) => (
  <Page heading="Users" subhead="Root password and additional user accounts.">
    <RootCard rootSet={rootSet} />
    {users.map((u) => (
      <UserCard u={u} />
    ))}
    <AddUserSlot />
  </Page>
)

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'user'

const RootCard = ({ rootSet }: { rootSet: boolean }) => {
  const signals = { root_password: '' }
  return (
    <form class="form card account-card" data-signals={JSON.stringify(signals)}>
      <div class="card-header">
        <h2 class="card-title">Root</h2>
      </div>
      <Field
        label="Password"
        htmlFor="root-pw"
        hint={rootSet ? 'Leave blank to keep existing.' : 'Required.'}
      >
        <input
          id="root-pw"
          class="combo"
          type="password"
          data-bind="root_password"
          placeholder="••••••"
        />
      </Field>
      <div class="form-actions">
        <button type="button" class="btn" data-on:click="@post('/api/users/root')">
          Save
        </button>
      </div>
    </form>
  )
}

const UserCard = ({ u }: { u: User }) => {
  const p = slug(u.username)
  const signals: Record<string, unknown> = {
    [`${p}_username`]: u.username,
    [`${p}_password`]: '',
    [`${p}_sudo`]: u.sudo,
    [`${p}_groups`]: u.groups.join(', '),
  }
  const saveUrl = `/api/users/save?original=${encodeURIComponent(u.username)}`
  const deleteUrl = `/api/users/delete?name=${encodeURIComponent(u.username)}`
  return (
    <form class="form card account-card" data-signals={JSON.stringify(signals)}>
      <div class="card-header">
        <h2 class="card-title" data-text={`$${p}_username || 'user'`} />
        <button type="button" class="btn btn-danger" data-on:click={`@post('${deleteUrl}')`}>
          Remove
        </button>
      </div>
      <Field label="Username" htmlFor={`${p}-name`}>
        <input
          id={`${p}-name`}
          class="combo"
          type="text"
          data-bind={`${p}_username`}
        />
      </Field>
      <Field label="Password" htmlFor={`${p}-pw`} hint="Leave blank to keep existing.">
        <input
          id={`${p}-pw`}
          class="combo"
          type="password"
          data-bind={`${p}_password`}
          placeholder="••••••"
        />
      </Field>
      <Field label="Sudo" htmlFor={`${p}-sudo`}>
        <label class="toggle">
          <input id={`${p}-sudo`} type="checkbox" data-bind={`${p}_sudo`} />
          <span data-text={`$${p}_sudo ? 'On' : 'Off'`} />
        </label>
      </Field>
      <Field label="Groups" htmlFor={`${p}-groups`} hint="Comma-separated.">
        <input
          id={`${p}-groups`}
          class="combo"
          type="text"
          data-bind={`${p}_groups`}
          placeholder="wheel, video"
        />
      </Field>
      <div class="form-actions">
        <button type="button" class="btn" data-on:click={`@post('${saveUrl}')`}>
          Save
        </button>
      </div>
    </form>
  )
}

const AddUserSlot = () => {
  const signals = {
    addingUser: false,
    new_username: '',
    new_password: '',
    new_sudo: true,
    new_groups: 'wheel',
  }
  return (
    <div data-signals={JSON.stringify(signals)}>
      <button
        type="button"
        class="btn"
        data-show="!$addingUser"
        data-on:click="$addingUser = true"
      >
        + Add another user
      </button>
      <form class="form card account-card" data-show="$addingUser">
        <div class="card-header">
          <h2 class="card-title" data-text="$new_username || 'new user'" />
          <button
            type="button"
            class="btn-link"
            data-on:click="$addingUser = false; $new_username = ''; $new_password = ''; $new_sudo = true; $new_groups = 'wheel'"
          >
            Cancel
          </button>
        </div>
        <Field label="Username" htmlFor="new-name">
          <input id="new-name" class="combo" type="text" data-bind="new_username" />
        </Field>
        <Field label="Password" htmlFor="new-pw">
          <input
            id="new-pw"
            class="combo"
            type="password"
            data-bind="new_password"
            placeholder="••••••"
          />
        </Field>
        <Field label="Sudo" htmlFor="new-sudo">
          <label class="toggle">
            <input id="new-sudo" type="checkbox" data-bind="new_sudo" />
            <span data-text="$new_sudo ? 'On' : 'Off'" />
          </label>
        </Field>
        <Field label="Groups" htmlFor="new-groups" hint="Comma-separated.">
          <input
            id="new-groups"
            class="combo"
            type="text"
            data-bind="new_groups"
            placeholder="wheel, video"
          />
        </Field>
        <div class="form-actions">
          <button type="button" class="btn" data-on:click="@post('/api/users/create')">
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
