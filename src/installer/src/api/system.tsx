import type { Child } from 'hono/jsx'
import type { AppContext } from '@bicycle/datastar'
import { SystemView } from '../views/system'
import { hostnameSignals, HostnameStatus } from '../views/hostname'
import { timezoneSignals, ntpSignals } from '../views/timezone'
import { networkSignals } from '../views/network'
import { localeSignals } from '../views/locale'
import { kbLayouts, locales, timezones, languages, encodings } from '../system'
import { editScalar, editNode } from '../state'
import { configState, editHandler, patchSidecar } from '../render'

export const systemBody = async (): Promise<Child> => {
  const { bike } = configState()
  const [kb, locs, zones] = await Promise.all([kbLayouts(), locales(), timezones()])
  const lc = bike.locale ?? { keyboard: 'us', language: 'en_US.UTF-8', encoding: 'UTF-8' }
  return (
    <SystemView
      hostname={bike.core?.hostname ?? ''}
      locale={{
        state: { kb_layout: lc.keyboard, sys_lang: lc.language, sys_enc: lc.encoding },
        kbLayouts: kb,
        languages: languages(locs), encodings: encodings(locs),
      }}
      time={{ zone: bike.core?.timezone ?? 'UTC', zones, ntp: bike.core?.ntp ?? true }}
      network={{ mode: bike.network?.mode === 'networkmanager' ? 'nm' : 'iso' }}
    />
  )
}

// Empty would break the schema; keep the last valid hostname and say why.
export const hostname = (c: AppContext) => {
  const { hostname } = hostnameSignals.read(c)
  if (hostname) editScalar(['core', 'hostname'], hostname)
  return patchSidecar(<HostnameStatus status={hostname ? '' : 'hostname required'} />)
}
export const timezone = editHandler(timezoneSignals, (d) => editScalar(['core', 'timezone'], d.timezone))
export const ntp = editHandler(ntpSignals, (d) => editScalar(['core', 'ntp'], d.ntp))
export const network = editHandler(networkSignals, (d) =>
  editScalar(['network', 'mode'], d.mode === 'nm' ? 'networkmanager' : 'iso'))
export const locale = editHandler(localeSignals, (d) =>
  editNode(['locale'], { keyboard: d.kb_layout, language: d.sys_lang, encoding: d.sys_enc }))
