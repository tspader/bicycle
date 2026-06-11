import { Code, Sig } from './expression'

export type Props = Record<string, string>

export type EventMods = {
  prevent?: boolean
  stop?: boolean
  window?: boolean
  debounceMs?: number
}

const eventKey = (event: string, mods: EventMods = {}): string => {
  let key = `data-on:${event}`
  if (mods.prevent) key += '__prevent'
  if (mods.stop) key += '__stop'
  if (mods.window) key += '__window'
  if (mods.debounceMs != null) key += `__debounce.${mods.debounceMs}ms`
  return key
}

export const on = (event: string, action: Code, mods?: EventMods): Props => ({
  [eventKey(event, mods)]: action.code,
})

export const onInterval = (action: Code, ms: number): Props => ({
  [`data-on-interval__duration.${ms}ms`]: action.code,
})

export const effect = (action: Code): Props => ({ 'data-effect': action.code })
export const show = (cond: Code): Props => ({ 'data-show': cond.code })
export const text = (value: Code): Props => ({ 'data-text': value.code })
export const attr = (name: string, value: Code): Props => ({ [`data-attr:${name}`]: value.code })
export const cls = (name: string, cond: Code): Props => ({ [`data-class:${name}`]: cond.code })
export const bind = <T>(sig: Sig<T>): Props => ({ 'data-bind': sig.name })
