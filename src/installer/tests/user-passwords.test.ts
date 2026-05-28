import { test, expect, describe } from 'bun:test'
import {
  getUserPasswords, getUserPassword, setUserPassword,
  renameUserPassword, deleteUserPassword,
} from '../src/ui-state'

// The store is a module global; each test uses distinct usernames to stay
// isolated from the others.
describe('ui-state user password store', () => {
  test('set then get round-trips the cleartext', () => {
    setUserPassword('alice', 'hunter2')
    expect(getUserPassword('alice')).toBe('hunter2')
    expect(getUserPasswords().get('alice')).toBe('hunter2')
  })

  test('rename moves the clear to the new name', () => {
    setUserPassword('bob', 's3cret')
    renameUserPassword('bob', 'robert')
    expect(getUserPassword('bob')).toBeUndefined()
    expect(getUserPassword('robert')).toBe('s3cret')
  })

  test('rename to same name is a no-op', () => {
    setUserPassword('carol', 'pw')
    renameUserPassword('carol', 'carol')
    expect(getUserPassword('carol')).toBe('pw')
  })

  test('rename of an unknown user does not create an entry', () => {
    renameUserPassword('ghost', 'phantom')
    expect(getUserPassword('phantom')).toBeUndefined()
  })

  test('delete removes the entry', () => {
    setUserPassword('dave', 'pw')
    deleteUserPassword('dave')
    expect(getUserPassword('dave')).toBeUndefined()
  })
})
