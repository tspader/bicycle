import { createContext, useContext } from 'hono/jsx';
import { Jsonifiable } from '@starfederation/datastar-sdk/types'

export const defaultSignals = {
  q: '',
  hostname: '',
  ntp: true,
  addingUser: false,
} as const

export type Signal = Record<string, Jsonifiable>;

const context = createContext<Signal>({})
export const SignalProvider = context.Provider;

export type SignalName = keyof typeof defaultSignals

export const useSignal = <K extends SignalName>(name: K): typeof defaultSignals[K] => {
  const signal = useContext(context)[name] ?? defaultSignals[name]
  return signal as typeof defaultSignals[K]
}
