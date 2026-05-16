import { createContext, useContext } from 'hono/jsx';
import { Jsonifiable } from '@starfederation/datastar-sdk/types'

type Signal = Record<string, Jsonifiable>;

const context = createContext<Signal>({})
export const SignalProvider = context.Provider;
export const useSignal = (name: string) => useContext(context)[name]

