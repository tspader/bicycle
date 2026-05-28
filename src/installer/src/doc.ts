import { Document, parseDocument, isCollection, isSeq, YAMLSeq, type Node } from 'yaml'
import { loadBicycleDoc, type BicycleConfig } from '@bicycle/shared'

export type Path = (string | number)[]

const TO_STRING = { flowCollectionPadding: false, lineWidth: 0 } as const

export const resolved = (text: string): BicycleConfig => {
  if (!text.trim()) return {}
  return loadBicycleDoc(text).resolved
}

const open = (text: string): Document => {
  const doc = text.trim() ? parseDocument(text) : new Document({})
  if (doc.errors.length > 0) throw new Error(doc.errors[0]!.message)
  if (doc.contents == null || !isCollection(doc.contents)) {
    doc.contents = doc.createNode({}) as never
  }
  return doc
}

export const edit = (text: string, fn: (doc: Document) => void): string => {
  const doc = open(text)
  fn(doc)
  return doc.toString(TO_STRING)
}

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

// Convert a plain JS value into a YAML node, choosing flow style for arrays of
// scalars (matching bicycle.yml's `[a, b]` convention) and block style for
// arrays of objects (users/partitions/subvolumes). Object fields that are
// undefined are dropped so optional keys aren't emitted as `key: null`.
export const node = (doc: Document, value: unknown): Node => {
  if (Array.isArray(value)) {
    const seq = doc.createNode(value.map((v) => node(doc, v))) as YAMLSeq
    if (value.every(isScalar)) seq.flow = true
    return seq
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, Node> = {}
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue
      out[k] = node(doc, v)
    }
    return doc.createNode(out)
  }
  return doc.createNode(value)
}

export const setScalar = (text: string, path: Path, value: string | number | boolean): string =>
  edit(text, (doc) => doc.setIn(path, value))

export const setNode = (text: string, path: Path, value: unknown): string =>
  edit(text, (doc) => doc.setIn(path, node(doc, value)))

export const deleteAt = (text: string, path: Path): string =>
  edit(text, (doc) => { doc.deleteIn(path) })

// Append to the seq at `path`, creating a single-element flow/block seq if the
// path doesn't exist yet.
export const append = (text: string, path: Path, value: unknown): string =>
  edit(text, (doc) => {
    const cur = doc.getIn(path)
    if (isSeq(cur)) doc.addIn(path, node(doc, value))
    else doc.setIn(path, node(doc, [value]))
  })

// Delete the collection at `path` if it exists and is empty (prunes orphaned
// `packages: {}` / `regions: []` after the last entry is removed).
export const pruneEmpty = (text: string, path: Path): string =>
  edit(text, (doc) => {
    const cur = doc.getIn(path)
    if (isCollection(cur) && cur.items.length === 0) doc.deleteIn(path)
  })
