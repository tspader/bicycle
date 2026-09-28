import type { Diff } from '@bicycle/shared'

export namespace State {
  export const DIRECTIONS = ['drift', 'missing', 'undeclared'] as const
  export type Direction = (typeof DIRECTIONS)[number]

  export type Ref = { kind: string; diff: Diff }

  export type Session = {
    selection: Map<string, Ref>
    anchor: string | null
    order: string[]
    known: Map<string, Ref>
    q: string
    dirs: Set<Direction>
    page: string | null
  }

  export const create = (): Session => ({
    selection: new Map(),
    anchor: null,
    order: [],
    known: new Map(),
    q: '',
    dirs: new Set(DIRECTIONS),
    page: null,
  })

  export function direction(d: Diff): Direction {
    if (d.expected === null) return 'undeclared'
    if (d.actual === null) return 'missing'
    if (d.expected === true && d.actual === false) return 'missing'
    return 'drift'
  }

  export const key = (d: Diff): string => 'd-' + Buffer.from(`${d.type} ${d.id} ${d.field}`).toString('base64url')

  export function show(session: Session, visible: string[], all: Map<string, Ref>): void {
    session.order = visible
    session.known = all
    for (const id of [...session.selection.keys()]) {
      if (!all.has(id)) session.selection.delete(id)
    }
    if (session.anchor !== null && !all.has(session.anchor)) session.anchor = null
  }

  export const hidden = (session: Session): number =>
    [...session.selection.keys()].filter((id) => !session.order.includes(id)).length

  function range(session: Session, id: string): string[] {
    const a = session.anchor === null ? -1 : session.order.indexOf(session.anchor)
    const b = session.order.indexOf(id)
    if (a < 0 || b < 0) return []
    return session.order.slice(Math.min(a, b), Math.max(a, b) + 1)
  }

  export function extend(session: Session, id: string): void {
    const ids = range(session, id)
    if (ids.length === 0) return toggle(session, id)
    for (const each of ids) session.selection.set(each, session.known.get(each)!)
    session.anchor = id
  }

  export function toggle(session: Session, id: string): void {
    const ref = session.known.get(id)
    if (ref === undefined) return
    if (!session.selection.delete(id)) session.selection.set(id, ref)
    session.anchor = id
  }

  export function group(session: Session, kind: string): void {
    const ids = session.order.filter((id) => session.known.get(id)?.kind === kind)
    const all = ids.length > 0 && ids.every((id) => session.selection.has(id))
    for (const id of ids) {
      if (all) session.selection.delete(id)
      else session.selection.set(id, session.known.get(id)!)
    }
  }

  export function flip(session: Session, dir: Direction): void {
    if (!session.dirs.delete(dir)) session.dirs.add(dir)
  }

  export function clear(session: Session): void {
    session.selection.clear()
    session.anchor = null
  }

  export function drop(session: Session, ids: string[]): void {
    for (const id of ids) session.selection.delete(id)
  }
}
