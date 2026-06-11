import { z } from 'zod'
import { Field, Section } from './layout'
import type { LocaleConfig } from '../config'
import { type Sig, bind, on, signals } from '@bicycle/datastar'
import { routes } from '../routes'

export const localeSignals = signals({
  kb_layout: z.string().min(1),
  sys_lang: z.string().min(1),
  sys_enc: z.string().min(1),
})

type Props = {
  state: LocaleConfig
  kbLayouts: string[]
  languages: string[]
  encodings: string[]
}

const Combo = ({
  id,
  sig,
  value,
  options,
}: {
  id: string
  sig: Sig<string>
  value: string
  options: string[]
}) => (
  <select id={id} class="combo" {...bind(sig)} {...on('change', routes.locale.action())}>
    {options.map((opt) => (
      <option value={opt} selected={opt === value}>
        {opt}
      </option>
    ))}
  </select>
)

export const LocaleSection = ({ state, kbLayouts, languages, encodings }: Props) => (
  <Section title="Locale" subhead="Keyboard layout, language, and encoding.">
    <form class="form" {...localeSignals.seed(state)}>
      <Field label="Keyboard layout" htmlFor="kb_layout">
        <Combo id="kb_layout" sig={localeSignals.$.kb_layout} value={state.kb_layout} options={kbLayouts} />
      </Field>
      <Field label="Language" htmlFor="sys_lang">
        <Combo id="sys_lang" sig={localeSignals.$.sys_lang} value={state.sys_lang} options={languages} />
      </Field>
      <Field label="Encoding" htmlFor="sys_enc">
        <Combo id="sys_enc" sig={localeSignals.$.sys_enc} value={state.sys_enc} options={encodings} />
      </Field>
    </form>
  </Section>
)
