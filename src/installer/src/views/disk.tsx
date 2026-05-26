import { Page, Section, Field } from './layout'
import { SwapSection } from './swap'
import { PRESETS, sizeBytes, type PresetId } from '../config'
import type { DeviceModification, PartitionConfig, PartitionFlag, FsType } from '../config'
import type { DiskInfo } from '../system'
import { sigSlug } from '../slug'

const FS_OPTIONS: FsType[] = ['fat32', 'ext4', 'btrfs', 'xfs', 'f2fs', 'linux-swap']
const FLAG_OPTIONS: PartitionFlag[] = ['boot', 'esp', 'swap']
const ENC_TYPES = [
  { id: 'luks', label: 'LUKS' },
  { id: 'lvm_on_luks', label: 'LVM on LUKS' },
  { id: 'luks_on_lvm', label: 'LUKS on LVM' },
] as const

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

const formatSize = (p: PartitionConfig): string => `${p.size.value}${p.size.unit}`

type Swap = { enabled: boolean; algorithm: 'zstd' | 'lzo-rle' | 'lzo' | 'lz4' | 'lz4hc' }

type Props = {
  disks: DiskInfo[]
  selected: DeviceModification[]
  openDisk: string | null
  error: string | null
  encryption: { type: string; password: boolean; objIds: Set<string> }
  swap: Swap
}

export const DiskView = ({ disks, selected, openDisk, error, encryption, swap }: Props) => {
  const modByDevice = new Map(selected.map((m) => [m.device, m]))
  const open = openDisk ? disks.find((d) => d.path === openDisk) ?? null : null
  const openMod = open ? modByDevice.get(open.path) ?? null : null
  return (
    <Page heading="Disk" subhead="Pick disks, lay out partitions, set encryption.">
      {disks.length === 0 ? (
        <p class="empty">No disks detected.</p>
      ) : (
        <DisksTable disks={disks} modByDevice={modByDevice} openDisk={openDisk} />
      )}
      {open ? (
        <DiskPanel
          d={open}
          mod={openMod}
          error={error}
          encryptedObjIds={encryption.objIds}
        />
      ) : null}
      {encryption.objIds.size > 0 ? (
        <EncryptionSection type={encryption.type} hasPassword={encryption.password} />
      ) : null}
      <SwapSection enabled={swap.enabled} algorithm={swap.algorithm} />
    </Page>
  )
}

const DisksTable = ({
  disks, modByDevice, openDisk,
}: {
  disks: DiskInfo[]
  modByDevice: Map<string, DeviceModification>
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
        const mod = modByDevice.get(d.path) ?? null
        const isOpen = openDisk === d.path
        const openUrl = `/api/disk/open?${isOpen ? '' : `device=${encodeURIComponent(d.path)}`}`
        const count = mod?.partitions.length ?? 0
        return (
          <tr
            class={`row disks-row${isOpen ? ' row-selected' : ''}`}
            data-on:click={`@post('${openUrl}')`}
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
  d, mod, error, encryptedObjIds,
}: {
  d: DiskInfo
  mod: DeviceModification | null
  error: string | null
  encryptedObjIds: Set<string>
}) => {
  const totalSize = d.size
  const partitions = mod?.partitions ?? []
  const explicitBytes = partitions
    .filter((p) => p.original_size !== 'rest')
    .reduce((acc, p) => acc + sizeBytes(p.size), 0)
  const hasRest = partitions.some((p) => p.original_size === 'rest')
  // "rest" needs at least 1MiB after the explicit partitions (matches the
  // GPT-tail margin in buildPartitions). Without "rest", explicit may equal
  // exactly the disk size.
  const overflow = hasRest ? explicitBytes >= totalSize : explicitBytes > totalSize
  const remaining = totalSize - explicitBytes
  const footerLabel = overflow
    ? `${formatBytes(explicitBytes)} allocated · over by ${formatBytes(-remaining)}`
    : `${formatBytes(explicitBytes)} allocated · ${hasRest ? `${formatBytes(remaining)} for "rest"` : `${formatBytes(remaining)} remaining`}`
  return (
    <Section
      title={d.path}
      subhead={`${d.model} · GPT · ${formatBytes(totalSize)}`}
    >
      <div class="disk-panel card">
        <div class="disk-panel-presets">
          <span class="field-label">Presets</span>
          <div class="preset-row">
            {(Object.entries(PRESETS) as Array<[PresetId, { label: string }]>).map(([id, p]) => (
              <button
                type="button"
                class="btn btn-sm"
                data-on:click={`@post('/api/disk/preset?device=${encodeURIComponent(d.path)}&id=${id}')`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {error ? <div class="alert alert-danger">{error}</div> : null}
        <PartitionTable
          device={d.path}
          partitions={partitions}
          encryptedObjIds={encryptedObjIds}
        />
        <div class="partition-footer">
          <button
            type="button"
            class="btn"
            data-on:click={`@post('/api/disk/partition/add?device=${encodeURIComponent(d.path)}')`}
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
  device, partitions, encryptedObjIds,
}: {
  device: string
  partitions: PartitionConfig[]
  encryptedObjIds: Set<string>
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
            <PartitionRow
              device={device}
              idx={i}
              p={p}
              isFirst={i === 0}
              isEncrypted={encryptedObjIds.has(p.obj_id)}
            />
            {p.fs_type === 'btrfs' ? (
              <tr class="subvol-expand-row">
                <td colspan={PARTITION_COLSPAN}>
                  <SubvolPanel device={device} idx={i} subvols={p.btrfs} />
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
  device, idx, p, isFirst, isEncrypted,
}: {
  device: string
  idx: number
  p: PartitionConfig
  isFirst: boolean
  isEncrypted: boolean
}) => {
  const sl = `${sigSlug(device)}_p${idx}`
  const signals: Record<string, unknown> = {
    [`${sl}_mount`]: p.mountpoint ?? '',
    [`${sl}_fs`]: p.fs_type,
    [`${sl}_size`]: p.original_size ?? formatSize(p),
    [`${sl}_start`]: p.original_start ?? '',
    [`${sl}_mount_options`]: p.mount_options.join(', '),
    [`${sl}_encrypt`]: isEncrypted,
  }
  for (const f of FLAG_OPTIONS) {
    signals[`${sl}_flag_${f}`] = p.flags.includes(f)
  }
  const saveUrl = `/api/disk/partition/save?device=${encodeURIComponent(device)}&idx=${idx}`
  const delUrl = `/api/disk/partition/delete?device=${encodeURIComponent(device)}&idx=${idx}`
  const save = `@post('${saveUrl}')`
  return (
    <tr class="row partition-row" data-signals={JSON.stringify(signals)}>
      <td class="col-del">
        <button
          type="button" class="btn btn-icon btn-danger"
          title="Delete partition"
          data-on:click={`@post('${delUrl}')`}
        >×</button>
      </td>
      <td>
        <input
          class="cell-input" type="text"
          data-bind={`${sl}_mount`} placeholder="/mountpoint"
          data-on:change={save}
        />
      </td>
      <td class="col-fs">
        <select class="cell-input" data-bind={`${sl}_fs`} data-on:change={save}>
          {FS_OPTIONS.map((f) => (
            <option value={f} selected={f === p.fs_type}>{f}</option>
          ))}
        </select>
      </td>
      <td class="col-size">
        <input
          class="cell-input" type="text"
          data-bind={`${sl}_size`} placeholder='1GiB / "rest"'
          data-on:change={save}
        />
      </td>
      <td class="col-start">
        {isFirst ? (
          <input
            class="cell-input" type="text"
            data-bind={`${sl}_start`} placeholder="1MiB"
            data-on:change={save}
          />
        ) : <span class="muted">—</span>}
      </td>
      {FLAG_OPTIONS.map((f) => (
        <td class="col-flag">
          <input
            type="checkbox" data-bind={`${sl}_flag_${f}`}
            checked={p.flags.includes(f)} data-on:change={save}
          />
        </td>
      ))}
      <td class="col-flag">
        <input
          type="checkbox" data-bind={`${sl}_encrypt`}
          checked={isEncrypted} data-on:change={save}
        />
      </td>
      <td>
        <input
          class="cell-input" type="text"
          data-bind={`${sl}_mount_options`} placeholder="..."
          data-on:change={save}
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
  subvols: PartitionConfig['btrfs']
}) => {
  const addUrl = `/api/disk/partition/subvol/add?device=${encodeURIComponent(device)}&idx=${idx}`
  return (
    <table class="table subvol-table">
      <thead>
        <tr>
          <th class="subvol-col-name">Name</th>
          <th>Mount</th>
          <th class="col-del" />
        </tr>
      </thead>
      <tbody>
        {subvols.map((sv, sIdx) => {
          const sl = `${sigSlug(device)}_p${idx}_sv${sIdx}`
          const saveUrl = `/api/disk/partition/subvol/save?device=${encodeURIComponent(device)}&idx=${idx}&subIdx=${sIdx}`
          const delUrl = `/api/disk/partition/subvol/delete?device=${encodeURIComponent(device)}&idx=${idx}&subIdx=${sIdx}`
          const signals = { [`${sl}_name`]: sv.name, [`${sl}_mount`]: sv.mountpoint ?? '' }
          const save = `@post('${saveUrl}')`
          return (
            <tr class="row subvol-row" data-signals={JSON.stringify(signals)}>
              <td class="subvol-col-name">
                <input
                  class="cell-input" type="text"
                  data-bind={`${sl}_name`} placeholder="@home"
                  data-on:change={save}
                />
              </td>
              <td>
                <input
                  class="cell-input" type="text"
                  data-bind={`${sl}_mount`} placeholder="/home"
                  data-on:change={save}
                />
              </td>
              <td class="col-del">
                <button
                  type="button" class="btn btn-icon btn-danger"
                  title="Delete subvolume"
                  data-on:click={`@post('${delUrl}')`}
                >×</button>
              </td>
            </tr>
          )
        })}
        <tr class="row subvol-add-row" data-on:click={`@post('${addUrl}')`}>
          <td colspan={3}>+ Add subvolume</td>
        </tr>
      </tbody>
    </table>
  )
}

export const EncryptionSection = ({ type, hasPassword }: { type: string; hasPassword: boolean }) => {
  const signals = { enc_type: type, enc_password: '' }
  return (
    <Section title="Encryption" subhead="Set the LUKS password for any encrypted partitions.">
      <form class="form card" data-signals={JSON.stringify(signals)}>
        <Field label="Type" htmlFor="enc-type">
          <select
            id="enc-type"
            class="combo"
            data-bind="enc_type"
            data-on:change="@post('/api/disk/encryption-type')"
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
            data-bind="enc_password"
            placeholder={hasPassword ? '•••••• (set; leave blank to keep)' : '••••••'}
            data-on:change="@post('/api/disk/encryption-password')"
          />
        </Field>
      </form>
    </Section>
  )
}
