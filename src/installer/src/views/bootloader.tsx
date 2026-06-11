import { z } from 'zod'
import { Field, Section, onOff } from './layout'
import { type Sig, bind, on, signals } from '../datastar'
import { routes } from '../routes'

const LOADERS = ['systemd-boot', 'grub', 'efistub', 'limine', 'refind'] as const

export const bootloaderSignals = signals({
  loader: z.enum(LOADERS),
  uki: z.boolean(),
  removable: z.boolean(),
})

type Props = { loader: (typeof LOADERS)[number]; uki: boolean; removable: boolean }

const Toggle = ({
  id,
  label,
  sig,
  checked,
}: {
  id: string
  label: string
  sig: Sig<boolean>
  checked: boolean
}) => (
  <Field label={label} htmlFor={id}>
    <label class="toggle">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        {...bind(sig)}
        {...on('change', routes.bootloader.action())}
      />
      <span {...onOff(sig)} />
    </label>
  </Field>
)

export const BootloaderSection = ({ loader, uki, removable }: Props) => (
  <Section title="Bootloader" subhead="UEFI boot manager.">
    <form class="form" {...bootloaderSignals.seed({ loader, uki, removable })}>
      <Field label="Loader" htmlFor="loader">
        <select
          id="loader"
          class="combo"
          {...bind(bootloaderSignals.$.loader)}
          {...on('change', routes.bootloader.action())}
        >
          {LOADERS.map((l) => (
            <option value={l} selected={l === loader}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Toggle id="uki" label="Unified Kernel Image" sig={bootloaderSignals.$.uki} checked={uki} />
      <Toggle id="removable" label="Removable install" sig={bootloaderSignals.$.removable} checked={removable} />
    </form>
  </Section>
)
