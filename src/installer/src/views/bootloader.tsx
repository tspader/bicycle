import { z } from 'zod'
import { Field, Section, Switch } from './layout'
import { bind, on, signals } from '@bicycle/datastar'
import { routes } from '../routes'

const LOADERS = ['systemd-boot', 'grub', 'efistub', 'limine', 'refind'] as const

export const bootloaderSignals = signals({
  loader: z.enum(LOADERS),
  uki: z.boolean(),
  removable: z.boolean(),
})

type Props = { loader: (typeof LOADERS)[number]; uki: boolean; removable: boolean }

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
      <Field label="Unified Kernel Image" htmlFor="uki">
        <Switch id="uki" sig={bootloaderSignals.$.uki} checked={uki} action={routes.bootloader.action()} />
      </Field>
      <Field label="Removable install" htmlFor="removable">
        <Switch
          id="removable"
          sig={bootloaderSignals.$.removable}
          checked={removable}
          action={routes.bootloader.action()}
        />
      </Field>
    </form>
  </Section>
)
