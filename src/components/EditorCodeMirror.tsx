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
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        autocompletion: true,
      }}
      onChange={onChange}
      className="editor-codemirror"
    />
  )
}
