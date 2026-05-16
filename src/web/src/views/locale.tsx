import { Field, Section } from './layout'
import type { LocaleConfig } from '../config'

type Props = {
  state: LocaleConfig
  kbLayouts: string[]
  languages: string[]
  encodings: string[]
}

const SIGNAL_KEY: Record<keyof LocaleConfig, string> = {
  kb_layout: 'kbLayout',
  sys_lang: 'sysLang',
  sys_enc: 'sysEnc',
}

const Combo = ({
  id,
  field,
  value,
  options,
}: {
  id: string
  field: keyof LocaleConfig
  value: string
  options: string[]
}) => (
  <select
    id={id}
    class="combo"
    data-bind={SIGNAL_KEY[field]}
    data-on-change="@post('/api/locale')"
  >
    {options.map((opt) => (
      <option value={opt} selected={opt === value}>
        {opt}
      </option>
    ))}
  </select>
)

export const LocaleSection = ({ state, kbLayouts, languages, encodings }: Props) => {
  const signals = {
    kbLayout: state.kb_layout,
    sysLang: state.sys_lang,
    sysEnc: state.sys_enc,
  }
  return (
    <Section id="locale" title="Locale" subhead="Keyboard layout, language, and encoding.">
      <form class="form" data-signals={JSON.stringify(signals)}>
        <Field label="Keyboard layout" htmlFor="kb_layout" hint="Console keymap (localectl).">
          <Combo id="kb_layout" field="kb_layout" value={state.kb_layout} options={kbLayouts} />
        </Field>
        <Field label="Language" htmlFor="sys_lang" hint="Glibc locale (e.g. en_US.UTF-8).">
          <Combo id="sys_lang" field="sys_lang" value={state.sys_lang} options={languages} />
        </Field>
        <Field label="Encoding" htmlFor="sys_enc" hint="Character encoding for the locale.">
          <Combo id="sys_enc" field="sys_enc" value={state.sys_enc} options={encodings} />
        </Field>
        <p class="save-hint" data-text="'Saved · ' + $kbLayout + ' / ' + $sysLang + ' / ' + $sysEnc" />
      </form>
    </Section>
  )
}
