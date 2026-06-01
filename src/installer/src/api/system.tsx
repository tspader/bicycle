import type { Child } from 'hono/jsx'
import { SystemView } from '../views/system'
import { kbLayouts, locales, timezones, languages, encodings } from '../system'
import { editScalar, editNode } from '../state'
import { configState, editHandler } from '../render'
import { Api } from './types'

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

export const hostname = editHandler(Api.Hostname, (d) => editScalar(['core', 'hostname'], d.hostname))
export const timezone = editHandler(Api.Timezone, (d) => editScalar(['core', 'timezone'], d.timezone))
export const ntp = editHandler(Api.Ntp, (d) => editScalar(['core', 'ntp'], d.ntp))
export const network = editHandler(Api.Network, (d) =>
  editScalar(['network', 'mode'], d.mode === 'nm' ? 'networkmanager' : 'iso'))
export const locale = editHandler(Api.Locale, (d) =>
  editNode(['locale'], { keyboard: d.kbLayout, language: d.sysLang, encoding: d.sysEnc }))
