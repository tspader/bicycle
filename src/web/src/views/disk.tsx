import { Page, Section, Field } from './layout'
import { SwapSection } from './swap'
import { PRESETS, type PresetId } from '../config'
import type { ArchinstallConfig, PartitionConfig, PartitionFlag, FsType } from '../config'
import type { DiskInfo } from '../system'

type DeviceMod = NonNullable<ArchinstallConfig['disk_config']>['device_modifications'][number]

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

const slug = (s: string): string => s.replace(/[^a-z0-9]/gi, '_').replace(/^_+/, '')

type Swap = { enabled: boolean; algorithm: 'zstd' | 'lzo-rle' | 'lzo' | 'lz4' | 'lz4hc' }

type Props = {
  disks: DiskInfo[]
  selected: DeviceMod[]
  encryption: { type: string; password: boolean; objIds: Set<string> }
  swap: Swap
}

export const DiskView = ({ disks, selected, encryption, swap }: Props) => (
  <Page heading="Disk" subhead="Pick disks, lay out partitions, set encryption.">
    <DisksSection disks={disks} selected={new Set(selected.map((d) => d.device))} />
    {selected.map((d) => {
      const info = disks.find((x) => x.path === d.device)
      return <DiskPanel mod={d} totalSize={info?.size ?? 0} encryptedObjIds={encryption.objIds} />
    })}
    {encryption.objIds.size > 0 ? (
      <EncryptionSection type={encryption.type} hasPassword={encryption.password} />
    ) : null}
    <SwapSection enabled={swap.enabled} algorithm={swap.algorithm} />
  </Page>
)

export const DisksSection = ({
  disks,
  selected,
}: {
  disks: DiskInfo[]
  selected: Set<string>
}) => (
  <Section title="Disks" subhead="Disks to install onto. Selected disks will be wiped.">
    <div id="disk-list" class="disk-list">
      {disks.length === 0 ? (
        <p class="empty">No disks detected.</p>
      ) : (
        disks.map((d) => <DiskRow d={d} selected={selected.has(d.path)} />)
      )}
    </div>
  </Section>
)

const DiskRow = ({ d, selected }: { d: DiskInfo; selected: boolean }) => {
  const toggleUrl = `/api/disk/toggle?device=${encodeURIComponent(d.path)}`
  return (
    <div class="disk-row" data-on:click={`if(evt.target.closest('input')) return; @post('${toggleUrl}')`}>
      <input
        type="checkbox"
        class="pkg-check"
        checked={selected}
        data-on:change={`@post('${toggleUrl}')`}
      />
      <span class="disk-path mono">{d.path}</span>
      <span class="disk-model">{d.model}</span>
      <span class="disk-size mono">{formatBytes(d.size)}</span>
      <span class="muted small">{d.sectorSize}B sectors</span>
      {d.isBoot ? <span class="chip chip-warn">boot medium</span> : null}
    </div>
  )
}

export const DiskPanel = ({
  mod, totalSize, encryptedObjIds,
}: {
  mod: DeviceMod
  totalSize: number
  encryptedObjIds: Set<string>
}) => {
  const sl = slug(mod.device)
  const explicitBytes = mod.partitions
    .filter((p) => p.original_size !== 'rest')
    .reduce((acc, p) => acc + sizeBytes(p), 0)
  const remaining = Math.max(0, totalSize - explicitBytes)
  const hasRest = mod.partitions.some((p) => p.original_size === 'rest')
  return (
    <Section title={mod.device} subhead={`GPT · wipe · ${formatBytes(totalSize)}`}>
      <div class="form">
        <Field label="Presets">
          <div class="preset-row">
            {(Object.entries(PRESETS) as Array<[PresetId, { label: string }]>).map(([id, p]) => (
              <button
                type="button"
                class="btn"
                data-on:click={`@post('/api/disk/preset?device=${encodeURIComponent(mod.device)}&id=${id}')`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Field>
      </div>
      <div class="partition-list">
        {mod.partitions.length === 0 ? (
          <p class="empty">No partitions. Pick a preset or add one below.</p>
        ) : (
          mod.partitions.map((p, i) => (
            <PartitionRow device={mod.device} idx={i} p={p} isFirst={i === 0} isEncrypted={encryptedObjIds.has(p.obj_id)} />
          ))
        )}
      </div>
      <div class="form-actions">
        <button
          type="button"
          class="btn"
          data-on:click={`@post('/api/disk/partition/add?device=${encodeURIComponent(mod.device)}')`}
        >
          + Add partition
        </button>
      </div>
      <p class="disk-footer mono small">
        {formatBytes(explicitBytes)} allocated · {hasRest ? `${formatBytes(remaining)} for "rest"` : `${formatBytes(remaining)} remaining`}
      </p>
      <div id={`disk-panel-${sl}`} />{/* marker for SSE patching */}
    </Section>
  )
}

const sizeBytes = (p: PartitionConfig): number => {
  const mul: Record<typeof p.size.unit, number> = {
    B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4,
  }
  return p.size.value * mul[p.size.unit]
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
  const sl = `${slug(device)}_p${idx}`
  const signals: Record<string, unknown> = {
    [`${sl}_open`]: false,
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
  return (
    <form class="partition-row card" data-signals={JSON.stringify(signals)}>
      <div class="partition-head">
        <input class="combo p-mount" type="text" data-bind={`${sl}_mount`} placeholder="/mountpoint" />
        <select class="combo p-fs" data-bind={`${sl}_fs`}>
          {FS_OPTIONS.map((f) => (
            <option value={f} selected={f === p.fs_type}>{f}</option>
          ))}
        </select>
        <input class="combo p-size" type="text" data-bind={`${sl}_size`} placeholder='1GiB or "rest"' />
        <button type="button" class="btn-link p-expand" data-on:click={`$${sl}_open = !$${sl}_open`}>
          <span data-text={`$${sl}_open ? '▾' : '▸'`} /> advanced
        </button>
        <button type="button" class="btn" data-on:click={`@post('${saveUrl}')`}>Save</button>
        <button type="button" class="btn btn-danger" data-on:click={`@post('${delUrl}')`}>×</button>
      </div>
      <div class="partition-advanced" data-show={`$${sl}_open`}>
        {isFirst ? (
          <Field label="Start" htmlFor={`${sl}-start`}>
            <input id={`${sl}-start`} class="combo" type="text" data-bind={`${sl}_start`} placeholder="1MiB" />
          </Field>
        ) : null}
        <Field label="Flags">
          <div class="chip-row">
            {FLAG_OPTIONS.map((f) => (
              <label class="toggle">
                <input type="checkbox" data-bind={`${sl}_flag_${f}`} checked={p.flags.includes(f)} />
                <span>{f}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="Mount options" htmlFor={`${sl}-mopts`}>
          <input id={`${sl}-mopts`} class="combo" type="text" data-bind={`${sl}_mount_options`} placeholder="compress=zstd, noatime" />
        </Field>
        <Field label="Encrypt" htmlFor={`${sl}-enc`}>
          <label class="toggle">
            <input id={`${sl}-enc`} type="checkbox" data-bind={`${sl}_encrypt`} checked={isEncrypted} />
            <span data-text={`$${sl}_encrypt ? 'On' : 'Off'`} />
          </label>
        </Field>
        {p.fs_type === 'btrfs' ? <SubvolEditor device={device} idx={idx} subvols={p.btrfs} /> : null}
      </div>
    </form>
  )
}

const formatSize = (p: PartitionConfig): string => `${p.size.value}${p.size.unit}`

const SubvolEditor = ({
  device, idx, subvols,
}: {
  device: string
  idx: number
  subvols: PartitionConfig['btrfs']
}) => {
  const addUrl = `/api/disk/partition/subvol/add?device=${encodeURIComponent(device)}&idx=${idx}`
  return (
    <Field label="Subvolumes">
      <div class="subvol-list">
        {subvols.map((sv, sIdx) => {
          const sl = `${slug(device)}_p${idx}_sv${sIdx}`
          const saveUrl = `/api/disk/partition/subvol/save?device=${encodeURIComponent(device)}&idx=${idx}&subIdx=${sIdx}`
          const delUrl = `/api/disk/partition/subvol/delete?device=${encodeURIComponent(device)}&idx=${idx}&subIdx=${sIdx}`
          const signals = { [`${sl}_name`]: sv.name, [`${sl}_mount`]: sv.mountpoint ?? '' }
          return (
            <div class="subvol-row" data-signals={JSON.stringify(signals)}>
              <input class="combo sv-name" type="text" data-bind={`${sl}_name`} placeholder="@home" />
              <span class="muted">→</span>
              <input class="combo sv-mount" type="text" data-bind={`${sl}_mount`} placeholder="/home" />
              <button type="button" class="btn" data-on:click={`@post('${saveUrl}')`}>Save</button>
              <button type="button" class="btn btn-danger" data-on:click={`@post('${delUrl}')`}>×</button>
            </div>
          )
        })}
        <button type="button" class="btn" data-on:click={`@post('${addUrl}')`}>+ Add subvolume</button>
      </div>
    </Field>
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
          />
        </Field>
        <div class="form-actions">
          <button type="button" class="btn" data-on:click="@post('/api/disk/encryption-password')">Save</button>
        </div>
      </form>
    </Section>
  )
}
