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

const sizeBytes = (p: PartitionConfig): number => {
  const mul: Record<typeof p.size.unit, number> = {
    B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4,
  }
  return p.size.value * mul[p.size.unit]
}

const formatSize = (p: PartitionConfig): string => `${p.size.value}${p.size.unit}`

type Swap = { enabled: boolean; algorithm: 'zstd' | 'lzo-rle' | 'lzo' | 'lz4' | 'lz4hc' }

type Props = {
  disks: DiskInfo[]
  selected: DeviceMod[]
  encryption: { type: string; password: boolean; objIds: Set<string> }
  swap: Swap
  selectedPartObjId: string | null
}

export const DiskView = ({ disks, selected, encryption, swap, selectedPartObjId }: Props) => (
  <Page heading="Disk" subhead="Pick disks, lay out partitions, set encryption.">
    <DisksSection disks={disks} selected={new Set(selected.map((d) => d.device))} />
    {selected.map((d) => {
      const info = disks.find((x) => x.path === d.device)
      return (
        <DiskPanel
          mod={d}
          totalSize={info?.size ?? 0}
          encryptedObjIds={encryption.objIds}
          selectedPartObjId={selectedPartObjId}
        />
      )
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
  mod, totalSize, encryptedObjIds, selectedPartObjId,
}: {
  mod: DeviceMod
  totalSize: number
  encryptedObjIds: Set<string>
  selectedPartObjId: string | null
}) => {
  const explicitBytes = mod.partitions
    .filter((p) => p.original_size !== 'rest')
    .reduce((acc, p) => acc + sizeBytes(p), 0)
  const remaining = Math.max(0, totalSize - explicitBytes)
  const hasRest = mod.partitions.some((p) => p.original_size === 'rest')
  const selectedIdx = mod.partitions.findIndex((p) => p.obj_id === selectedPartObjId)
  const selected = selectedIdx >= 0 ? mod.partitions[selectedIdx]! : null
  return (
    <Section title={mod.device} subhead={`GPT · wipe · ${formatBytes(totalSize)}`}>
      <div class="disk-panel card">
        <div class="disk-panel-presets">
          <span class="field-label">Presets</span>
          <div class="preset-row">
            {(Object.entries(PRESETS) as Array<[PresetId, { label: string }]>).map(([id, p]) => (
              <button
                type="button"
                class="btn btn-sm"
                data-on:click={`@post('/api/disk/preset?device=${encodeURIComponent(mod.device)}&id=${id}')`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div class="partition-editor">
          {selected ? (
            <PartitionDetail
              device={mod.device}
              idx={selectedIdx}
              p={selected}
              isFirst={selectedIdx === 0}
              isEncrypted={encryptedObjIds.has(selected.obj_id)}
            />
          ) : (
            <p class="partition-editor-empty muted">
              {mod.partitions.length === 0
                ? 'No partitions. Pick a preset, or add one below.'
                : 'Select a partition to edit it.'}
            </p>
          )}
        </div>
        <PartitionTable
          device={mod.device}
          partitions={mod.partitions}
          encryptedObjIds={encryptedObjIds}
          selectedPartObjId={selectedPartObjId}
        />
        <div class="partition-footer">
          <button
            type="button"
            class="btn"
            data-on:click={`@post('/api/disk/partition/add?device=${encodeURIComponent(mod.device)}')`}
          >
            + Add partition
          </button>
          <span class="mono small muted">
            {formatBytes(explicitBytes)} allocated · {hasRest ? `${formatBytes(remaining)} for "rest"` : `${formatBytes(remaining)} remaining`}
          </span>
        </div>
      </div>
    </Section>
  )
}

const PartitionTable = ({
  device, partitions, encryptedObjIds, selectedPartObjId,
}: {
  device: string
  partitions: PartitionConfig[]
  encryptedObjIds: Set<string>
  selectedPartObjId: string | null
}) => {
  if (partitions.length === 0) return null
  return (
    <table class="table partition-table">
      <thead>
        <tr>
          <th class="col-num">#</th>
          <th>Mount</th>
          <th class="col-fs">FS</th>
          <th class="col-size">Size</th>
          <th>Flags</th>
          <th class="col-enc">Enc</th>
          <th class="col-del" />
        </tr>
      </thead>
      <tbody>
        {partitions.map((p, i) => (
          <PartitionRow
            device={device}
            idx={i}
            p={p}
            isSelected={p.obj_id === selectedPartObjId}
            isEncrypted={encryptedObjIds.has(p.obj_id)}
          />
        ))}
      </tbody>
    </table>
  )
}

const PartitionRow = ({
  device, idx, p, isSelected, isEncrypted,
}: {
  device: string
  idx: number
  p: PartitionConfig
  isSelected: boolean
  isEncrypted: boolean
}) => {
  const selUrl = `/api/disk/partition/select?objId=${encodeURIComponent(p.obj_id)}`
  const delUrl = `/api/disk/partition/delete?device=${encodeURIComponent(device)}&idx=${idx}`
  return (
    <tr
      class={`row partition-row${isSelected ? ' row-selected' : ''}`}
      data-on:click={`if(evt.target.closest('button')) return; @post('${selUrl}')`}
    >
      <td class="col-num mono muted">{idx + 1}</td>
      <td class="mono">{p.mountpoint || <span class="muted">—</span>}</td>
      <td class="col-fs mono">{p.fs_type}</td>
      <td class="col-size mono">{p.original_size ?? formatSize(p)}</td>
      <td>
        {p.flags.length === 0 ? (
          <span class="muted">—</span>
        ) : (
          <div class="chip-row chip-row-tight">
            {p.flags.map((f) => <span class="chip">{f}</span>)}
          </div>
        )}
      </td>
      <td class="col-enc">{isEncrypted ? <span class="chip chip-enc">luks</span> : <span class="muted">—</span>}</td>
      <td class="col-del">
        <button
          type="button"
          class="btn btn-icon btn-danger"
          title="Delete partition"
          data-on:click={`@post('${delUrl}')`}
        >×</button>
      </td>
    </tr>
  )
}

const PartitionDetail = ({
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
  const save = `@post('${saveUrl}')`
  const isBtrfs = p.fs_type === 'btrfs'
  return (
    <form class="partition-form" data-signals={JSON.stringify(signals)}>
      <header class="partition-form-head">
        <h3 class="card-title">
          Partition {idx + 1}
          {p.mountpoint ? <span class="muted small"> {p.mountpoint}</span> : null}
        </h3>
        {p.original_size === 'rest' ? <span class="chip">fills disk</span> : null}
      </header>
      <div class="field-grid field-grid-3">
        <Field label="Mount" htmlFor={`${sl}-mount`}>
          <input
            id={`${sl}-mount`} class="combo" type="text"
            data-bind={`${sl}_mount`} placeholder="/mountpoint"
            data-on:change={save}
          />
        </Field>
        <Field label="Filesystem" htmlFor={`${sl}-fs`}>
          <select id={`${sl}-fs`} class="combo" data-bind={`${sl}_fs`} data-on:change={save}>
            {FS_OPTIONS.map((f) => (
              <option value={f} selected={f === p.fs_type}>{f}</option>
            ))}
          </select>
        </Field>
        <Field label="Size" htmlFor={`${sl}-size`}>
          <input
            id={`${sl}-size`} class="combo" type="text"
            data-bind={`${sl}_size`} placeholder='1GiB or "rest"'
            data-on:change={save}
          />
        </Field>
        {isFirst ? (
          <Field label="Start" htmlFor={`${sl}-start`}>
            <input
              id={`${sl}-start`} class="combo" type="text"
              data-bind={`${sl}_start`} placeholder="1MiB"
              data-on:change={save}
            />
          </Field>
        ) : null}
        <Field label="Mount options" htmlFor={`${sl}-mopts`}>
          <input
            id={`${sl}-mopts`} class="combo" type="text"
            data-bind={`${sl}_mount_options`} placeholder="compress=zstd, noatime"
            data-on:change={save}
          />
        </Field>
      </div>
      <div class="partition-form-toggles">
        <div class="toggle-group">
          <span class="field-label">Flags</span>
          <div class="chip-row">
            {FLAG_OPTIONS.map((f) => (
              <label class="toggle">
                <input
                  type="checkbox"
                  data-bind={`${sl}_flag_${f}`}
                  checked={p.flags.includes(f)}
                  data-on:change={save}
                />
                <span>{f}</span>
              </label>
            ))}
          </div>
        </div>
        <div class="toggle-group">
          <span class="field-label">Encrypt</span>
          <label class="toggle">
            <input
              type="checkbox" data-bind={`${sl}_encrypt`} checked={isEncrypted}
              data-on:change={save}
            />
            <span data-text={`$${sl}_encrypt ? 'On' : 'Off'`} />
          </label>
        </div>
      </div>
      {isBtrfs ? <SubvolPanel device={device} idx={idx} subvols={p.btrfs} /> : null}
    </form>
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
    <section class="subvol-panel">
      <header class="subvol-head">
        <h4 class="subvol-title">Subvolumes</h4>
        <button
          type="button" class="btn btn-sm"
          data-on:click={`@post('${addUrl}')`}
        >+ Add subvolume</button>
      </header>
      <div class="subvol-scroll">
        {subvols.length === 0 ? (
          <p class="muted small subvol-empty">No subvolumes.</p>
        ) : (
          <div class="subvol-list">
            <div class="subvol-row subvol-row-head">
              <span class="field-label">Name</span>
              <span />
              <span class="field-label">Mount</span>
              <span />
            </div>
            {subvols.map((sv, sIdx) => {
              const sl = `${slug(device)}_p${idx}_sv${sIdx}`
              const saveUrl = `/api/disk/partition/subvol/save?device=${encodeURIComponent(device)}&idx=${idx}&subIdx=${sIdx}`
              const delUrl = `/api/disk/partition/subvol/delete?device=${encodeURIComponent(device)}&idx=${idx}&subIdx=${sIdx}`
              const signals = { [`${sl}_name`]: sv.name, [`${sl}_mount`]: sv.mountpoint ?? '' }
              const save = `@post('${saveUrl}')`
              return (
                <div class="subvol-row" data-signals={JSON.stringify(signals)}>
                  <input
                    class="combo sv-name" type="text"
                    data-bind={`${sl}_name`} placeholder="@home"
                    data-on:change={save}
                  />
                  <span class="muted subvol-arrow">→</span>
                  <input
                    class="combo sv-mount" type="text"
                    data-bind={`${sl}_mount`} placeholder="/home"
                    data-on:change={save}
                  />
                  <button
                    type="button" class="btn btn-icon btn-danger"
                    title="Delete subvolume"
                    data-on:click={`@post('${delUrl}')`}
                  >×</button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
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
