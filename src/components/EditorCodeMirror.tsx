import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import type { Extension } from '@codemirror/state'
import type { AppTheme } from '../types'

type Props = {
  tabId: string
  value: string
  theme: AppTheme
  extensions: Extension[]
  onChange: (value: string) => void
}

const BASIC_SETUP = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLine: true,
  autocompletion: true,
} as const

export function EditorCodeMirror({
  tabId,
  value,
  theme,
  extensions,
  onChange,
}: Props) {
  return (
    <CodeMirror
      key={tabId}
      value={value}
      height="100%"
      theme={theme === 'light' ? 'light' : oneDark}
      extensions={extensions}
      basicSetup={BASIC_SETUP}
      onChange={onChange}
      className="editor-codemirror"
    />
  )
}
