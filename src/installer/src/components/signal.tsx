import { useSignal, SignalName } from "../signal"


export const Signals = ({ names, children }: {
  names: SignalName[],
  children?: any
}) => {
  const o = Object.fromEntries(names.map(name => [name, useSignal(name)]))
  return (
    <div data-signals={JSON.stringify(o)}>
      {children}
    </div>
  )
}

export const Signal = ({ name, children }: {
  name: SignalName,
  children?: any
}) => {
  return (
    <Signals names={[name]}>
      {children}
    </Signals>
  )
}
