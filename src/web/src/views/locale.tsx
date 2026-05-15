import { Layout, Page, Field } from './layout'
import type { LocaleState } from '../state'

type Props = {
  state: LocaleState
  kbLayouts: string[]
  languages: string[]
  encodings: string[]
}

const SIGNAL_KEY: Record<keyof LocaleState, string> = {
  kb_layout: 'kbLayout',
  sys_lang: 'sysLang',
  sys_enc: 'sysEnc',
}

export const LocaleView = ({ state, kbLayouts, languages, encodings }: Props) => {
  const Combo = ({
    id,
    field,
    value,
    options,
  }: {
    id: string
    field: keyof LocaleState
    value: string
    options: string[]
  }) => {
    return (
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
  }

  const initialSignals = {
    kbLayout: state.kb_layout,
    sysLang: state.sys_lang,
    sysEnc: state.sys_enc,
  }

  const formAttrs: Record<string, string> = {
    'data-signals': JSON.stringify(initialSignals),
  }

  return (
    <Layout active="locale">
      <Page heading="Locale" subhead="System keyboard layout, language, and encoding.">
        <form class="form" {...formAttrs}>
          <Field label="Keyboard layout" htmlFor="kb_layout" hint="Console keymap (localectl).">
            <Combo
              id="kb_layout"
              field="kb_layout"
              value={state.kb_layout}
              options={kbLayouts}
            />
          </Field>
          <Field label="Language" htmlFor="sys_lang" hint="Glibc locale (e.g. en_US.UTF-8).">
            <Combo id="sys_lang" field="sys_lang" value={state.sys_lang} options={languages} />
          </Field>
          <Field label="Encoding" htmlFor="sys_enc" hint="Character encoding for the locale.">
            <Combo id="sys_enc" field="sys_enc" value={state.sys_enc} options={encodings} />
          </Field>
          <p class="save-hint" data-text="'Saved · ' + $kbLayout + ' / ' + $sysLang + ' / ' + $sysEnc" />
        </form>
      </Page>
    </Layout>
  )
}
