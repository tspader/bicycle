import { Field, Section } from './layout'

const LOADERS = ['systemd-boot', 'grub', 'efistub', 'limine', 'refind'] as const

type Props = { loader: (typeof LOADERS)[number]; uki: boolean; removable: boolean }

export const BootloaderSection = ({ loader, uki, removable }: Props) => (
  <Section id="bootloader" title="Bootloader" subhead="UEFI boot manager.">
    <form class="form" data-signals={JSON.stringify({ loader, uki, removable })}>
      <Field label="Loader" htmlFor="loader">
        <select
          id="loader"
          class="combo"
          data-bind="loader"
          data-on-change="@post('/api/bootloader')"
        >
          {LOADERS.map((l) => (
            <option value={l} selected={l === loader}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Unified Kernel Image" htmlFor="uki" hint="Bundle kernel + initrd + cmdline.">
        <label class="toggle">
          <input
            id="uki"
            type="checkbox"
            data-bind="uki"
            data-on-change="@post('/api/bootloader')"
            checked={uki}
          />
          <span data-text="$uki ? 'On' : 'Off'" />
        </label>
      </Field>
      <Field label="Removable install" htmlFor="removable" hint="Install to /EFI/BOOT/BOOTX64.EFI for portable drives.">
        <label class="toggle">
          <input
            id="removable"
            type="checkbox"
            data-bind="removable"
            data-on-change="@post('/api/bootloader')"
            checked={removable}
          />
          <span data-text="$removable ? 'On' : 'Off'" />
        </label>
      </Field>
      <p class="save-hint" data-text="'Saved · ' + $loader" />
    </form>
  </Section>
)
