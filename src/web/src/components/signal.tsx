import { useSignal } from "../signal"


export const Signals = ({ names, children }: {
  names: string[],
  children?: any
}) => {
  const o = Object.fromEntries(names.map(name => [name, useSignal(name) ?? '']))
  return (
    <div data-signals={JSON.stringify(o)}>
      {children}
    </div>
  )
}

export const Signal = ({ name, children }: {
  name: string,
  children?: any
}) => {
  return (
    <Signals names={[name]}>
      {children}
    </Signals>
  )
}
