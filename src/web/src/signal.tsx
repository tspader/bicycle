import { createContext, useContext } from 'hono/jsx';
import type { CategoryId } from './ui-state';

export const defaultSignals = {
  q: '',
  hostname: '',
  ntp: true,
  addingUser: false,
  activeCat: 'system' as CategoryId,
}

//export type Signal = Record<string, Jsonifiable>;
//export type Signal = Partial<Record<string, Jsonifiable>>;
export type Signal = { [K in SignalName]?: typeof defaultSignals[K] }

const context = createContext<Signal>({})
export const SignalProvider = context.Provider;

export type SignalName = keyof typeof defaultSignals

export const useSignal = <K extends SignalName>(name: K): typeof defaultSignals[K] => {
  const signal = useContext(context)[name] ?? defaultSignals[name]
  return signal as typeof defaultSignals[K]
}
