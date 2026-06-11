import { z } from 'zod'
import { Page, Section, Field } from './layout'
import { SwapSection } from './swap'
import { PRESETS, parseSize, sizeBytes, FsType, type PresetId } from '../config'
import { EncryptionKind, type Disk, type Partition, type PartitionFlag } from '@bicycle/shared'
import type { DiskInfo } from '../system'
import { bind, on, signals } from '@bicycle/datastar'
import { routes } from '../routes'
import { sigSlug } from '../slug'

const FS_OPTIONS = FsType.options
export const FLAG_OPTIONS = ['boot', 'esp', 'swap'] as const satisfies readonly PartitionFlag[]
const ENC_TYPES = [
  { id: 'luks', label: 'LUKS' },
  { id: 'lvm_on_luks', label: 'LVM on LUKS' },
  { id: 'luks_on_lvm', label: 'LUKS on LVM' },
] as const

// Per-row signal groups for inline partition editing. The prefix carries the
// device + indices, so view and server derive identical signal names from the
// same factory.
export const partitionSignals = (device: string, idx: number) =>
  signals(
    {
      mount: z.string().default(''),
      fs: FsType,
      size: z.string().min(1),
      start: z.string().default(''),
      mount_options: z.string().default(''),
      encrypt: z.boolean().default(false),
      flag_boot: z.boolean().default(false),
      flag_esp: z.boolean().default(false),
      flag_swap: z.boolean().default(false),
    },
    `${sigSlug(device)}_p${idx}_`,
  )

export const subvolSignals = (device: string, idx: number, subIdx: number) =>
  signals(
    {
      name: z.string().trim().min(1, 'subvolume name required'),
      mount: z.string().default(''),
    },
    `${sigSlug(device)}_p${idx}_sv${subIdx}_`,
  )

export const encryptionSignals = signals({
  enc_type: EncryptionKind,
  enc_password: z.string().default(''),
})

const formatBytes = (n: number): string => {
  const units = [
    ['TiB', 1024 ** 4],
    ['GiB', 1024 ** 3],
    ['MiB', 1024 ** 2],
    ['KiB', 1024],
  ] as const
  for (const [unit, scale] of units) {
    if (n >= scale) {
      const v = n / scale
      return `${v % 1 === 0 ? v : v.toFixed(1)} ${unit}`
    }
  }
  return `${n} B`
}

const explicitBytesOf = (p: Partition): number => {
  if (p.size === 'rest') return 0
  try {
    return sizeBytes(parseSize(p.size))
  } catch {
    return 0
  }
}

type Swap = { enabled: boolean; algorithm: 'zstd' | 'lzo-rle' | 'lzo' | 'lz4' | 'lz4hc' }

type Props = {
  disks: DiskInfo[]
  bikeDisks: Disk[]
  openDisk: string | null
  error: string | null
  anyEncrypted: boolean
  encryption: { type: z.infer<typeof EncryptionKind>; password: boolean }
  swap: Swap
}

export const DiskView = ({ disks, bikeDisks, openDisk, error, anyEncrypted, encryption, swap }: Props) => {
  const diskByDevice = new Map(bikeDisks.map((d) => [d.device, d]))
  const open = openDisk ? disks.find((d) => d.path === openDisk) ?? null : null
  const openMod = open ? diskByDevice.get(open.path) ?? null : null
  return (
    <Page heading="Disk" subhead="Pick disks, lay out partitions, set encryption.">
      {disks.length === 0 ? (
        <p class="empty">No disks detected.</p>
      ) : (
        <DisksTable disks={disks} diskByDevice={diskByDevice} openDisk={openDisk} />
      )}
      {open ? <DiskPanel d={open} mod={openMod} error={error} /> : null}
      {anyEncrypted ? (
        <EncryptionSection type={encryption.type} hasPassword={encryption.password} />
      ) : null}
      <SwapSection enabled={swap.enabled} algorithm={swap.algorithm} />
    </Page>
  )
}

const DisksTable = ({
  disks, diskByDevice, openDisk,
}: {
  disks: DiskInfo[]
  diskByDevice: Map<string, Disk>
  openDisk: string | null
}) => (
  <table class="table disks-table">
    <thead>
      <tr>
        <th>Path</th>
        <th>Model</th>
        <th class="col-size">Size</th>
        <th>Status</th>
        <th class="col-boot">Boot</th>
      </tr>
    </thead>
    <tbody>
      {disks.map((d) => {
        const mod = diskByDevice.get(d.path) ?? null
        const isOpen = openDisk === d.path
        const count = mod?.partitions.length ?? 0
        return (
          <tr
            class={`row disks-row${isOpen ? ' row-selected' : ''}`}
            {...on('click', routes.diskOpen.action(isOpen ? {} : { device: d.path }))}
          >
            <td class="mono">{d.path}</td>
            <td>{d.model}</td>
            <td class="col-size mono">{formatBytes(d.size)}</td>
            <td class="muted small">
              {count === 0 ? 'unchanged' : `${count} partition${count === 1 ? '' : 's'}`}
            </td>
            <td class="col-boot muted">{d.isBoot ? 'yes' : 'no'}</td>
          </tr>
        )
      })}
    </tbody>
  </table>
)

export const DiskPanel = ({
  d, mod, error,
}: {
  d: DiskInfo
  mod: Disk | null
  error: string | null
}) => {
  const totalSize = d.size
  const partitions = mod?.partitions ?? []
  const explicitBytes = partitions.reduce((acc, p) => acc + explicitBytesOf(p), 0)
  const hasRest = partitions.some((p) => p.size === 'rest')
  const overflow = hasRest ? explicitBytes >= totalSize : explicitBytes > totalSize
  const remaining = totalSize - explicitBytes
  const footerLabel = overflow
    ? `${formatBytes(explicitBytes)} allocated · over by ${formatBytes(-remaining)}`
    : `${formatBytes(explicitBytes)} allocated · ${hasRest ? `${formatBytes(remaining)} for "rest"` : `${formatBytes(remaining)} remaining`}`
  return (
    <Section title={d.path} subhead={`${d.model} · GPT · ${formatBytes(totalSize)}`}>
      <div class="disk-panel card">
        <div class="disk-panel-presets">
          <span class="field-label">Presets</span>
          <div class="preset-row">
            {(Object.entries(PRESETS) as Array<[PresetId, { label: string }]>).map(([id, p]) => (
              <button
                type="button"
                class="btn btn-sm"
                {...on('click', routes.diskPreset.action({ device: d.path, id }))}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {error ? <div class="alert alert-danger">{error}</div> : null}
        <PartitionTable device={d.path} partitions={partitions} />
        <div class="partition-footer">
          <button
            type="button"
            class="btn"
            {...on('click', routes.partitionAdd.action({ device: d.path }))}
          >
            + Add partition
          </button>
          <span class={`mono small ${overflow ? 'warn' : 'muted'}`}>{footerLabel}</span>
        </div>
      </div>
    </Section>
  )
}

const PARTITION_COLSPAN = 11

const PartitionTable = ({
  device, partitions,
}: {
  device: string
  partitions: Partition[]
}) => {
  if (partitions.length === 0) return null
  return (
    <table class="table partition-table">
      <thead>
        <tr>
          <th class="col-del" />
          <th>Mount</th>
          <th class="col-fs">FS</th>
          <th class="col-size">Size</th>
          <th class="col-start">Start</th>
          {FLAG_OPTIONS.map((f) => <th class="col-flag">{f}</th>)}
          <th class="col-flag">enc</th>
          <th>Mount options</th>
        </tr>
      </thead>
      <tbody>
        {partitions.map((p, i) => (
          <>
            <PartitionRow device={device} idx={i} p={p} isFirst={i === 0} />
            {p.fs === 'btrfs' ? (
              <tr class="subvol-expand-row">
                <td colspan={PARTITION_COLSPAN}>
                  <SubvolPanel device={device} idx={i} subvols={p.subvolumes ?? []} />
                </td>
              </tr>
            ) : null}
          </>
        ))}
      </tbody>
    </table>
  )
}

const PartitionRow = ({
  device, idx, p, isFirst,
}: {
  device: string
  idx: number
  p: Partition
  isFirst: boolean
}) => {
  const group = partitionSignals(device, idx)
  const $ = group.$
  const flags = p.flags ?? []
  const save = routes.partitionSave.action({ device, idx })
  return (
    <tr
      class="row partition-row"
      {...group.seed({
        mount: p.mount ?? '',
        fs: p.fs,
        size: p.size,
        start: p.start ?? '',
        mount_options: (p.mount_options ?? []).join(', '),
        encrypt: !!p.encrypt,
        flag_boot: flags.includes('boot'),
        flag_esp: flags.includes('esp'),
        flag_swap: flags.includes('swap'),
      })}
    >
      <td class="col-del">
        <button
          type="button" class="btn btn-icon btn-danger"
          title="Delete partition"
          {...on('click', routes.partitionDelete.action({ device, idx }))}
        >×</button>
      </td>
      <td>
        <input
          class="cell-input" type="text" placeholder="/mountpoint"
          {...bind($.mount)} {...on('change', save)}
        />
      </td>
      <td class="col-fs">
        <select class="cell-input" {...bind($.fs)} {...on('change', save)}>
          {FS_OPTIONS.map((f) => (
            <option value={f} selected={f === p.fs}>{f}</option>
          ))}
        </select>
      </td>
      <td class="col-size">
        <input
          class="cell-input" type="text" placeholder='1GiB / "rest"'
          {...bind($.size)} {...on('change', save)}
        />
      </td>
      <td class="col-start">
        {isFirst ? (
          <input
            class="cell-input" type="text" placeholder="1MiB"
            {...bind($.start)} {...on('change', save)}
          />
        ) : <span class="muted">—</span>}
      </td>
      {FLAG_OPTIONS.map((f) => (
        <td class="col-flag">
          <input
            type="checkbox"
            checked={flags.includes(f)}
            {...bind($[`flag_${f}`])} {...on('change', save)}
          />
        </td>
      ))}
      <td class="col-flag">
        <input
          type="checkbox"
          checked={!!p.encrypt}
          {...bind($.encrypt)} {...on('change', save)}
        />
      </td>
      <td>
        <input
          class="cell-input" type="text" placeholder="..."
          {...bind($.mount_options)} {...on('change', save)}
        />
      </td>
    </tr>
  )
}

const SubvolPanel = ({
  device, idx, subvols,
}: {
  device: string
  idx: number
  subvols: NonNullable<Partition['subvolumes']>
}) => (
  <table class="table subvol-table">
    <thead>
      <tr>
        <th class="subvol-col-name">Name</th>
        <th>Mount</th>
        <th class="col-del" />
      </tr>
    </thead>
    <tbody>
      {subvols.map((sv, subIdx) => {
        const group = subvolSignals(device, idx, subIdx)
        const save = routes.subvolSave.action({ device, idx, subIdx })
        return (
          <tr class="row subvol-row" {...group.seed({ name: sv.name, mount: sv.mount ?? '' })}>
            <td class="subvol-col-name">
              <input
                class="cell-input" type="text" placeholder="@home"
                {...bind(group.$.name)} {...on('change', save)}
              />
            </td>
            <td>
              <input
                class="cell-input" type="text" placeholder="/home"
                {...bind(group.$.mount)} {...on('change', save)}
              />
            </td>
            <td class="col-del">
              <button
                type="button" class="btn btn-icon btn-danger"
                title="Delete subvolume"
                {...on('click', routes.subvolDelete.action({ device, idx, subIdx }))}
              >×</button>
            </td>
          </tr>
        )
      })}
      <tr class="row subvol-add-row" {...on('click', routes.subvolAdd.action({ device, idx }))}>
        <td colspan={3}>+ Add subvolume</td>
      </tr>
    </tbody>
  </table>
)

export const EncryptionSection = ({
  type, hasPassword,
}: {
  type: z.infer<typeof EncryptionKind>
  hasPassword: boolean
}) => (
  <Section title="Encryption" subhead="Set the LUKS password for any encrypted partitions.">
    <form class="form card" {...encryptionSignals.seed({ enc_type: type, enc_password: '' })}>
      <Field label="Type" htmlFor="enc-type">
        <select
          id="enc-type"
          class="combo"
          {...bind(encryptionSignals.$.enc_type)}
          {...on('change', routes.encryptionType.action())}
        >
          {ENC_TYPES.map((t) => (
            <option value={t.id} selected={t.id === type}>{t.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Password" htmlFor="enc-pw">
        <input
          id="enc-pw"
          class="combo"
          type="password"
          placeholder={hasPassword ? '•••••• (set; leave blank to keep)' : '••••••'}
          {...bind(encryptionSignals.$.enc_password)}
          {...on('change', routes.encryptionPassword.action())}
        />
      </Field>
    </form>
  </Section>
)
