import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { StreamLanguage } from '@codemirror/language'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import type { Extension } from '@codemirror/state'
import { fileExtension } from './editorSyntaxColors'

export function languageExtensionForPath(remotePath: string): Extension | null {
  const ext = fileExtension(remotePath)

  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return javascript({ jsx: true })
    case 'ts':
    case 'tsx':
      return javascript({ jsx: true, typescript: true })
    case 'json':
    case 'jsonc':
    case 'json5':
      return json()
    case 'yml':
    case 'yaml':
      return yaml()
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'bat':
    case 'cmd':
      return StreamLanguage.define(shell)
    case 'ps1':
      return StreamLanguage.define(powerShell)
    case 'properties':
    case 'props':
    case 'ini':
    case 'env':
    case 'conf':
    case 'config':
    case 'cfg':
      return StreamLanguage.define(properties)
    case 'html':
    case 'htm':
      return html()
    case 'css':
    case 'scss':
    case 'less':
      return css()
    case 'py':
      return python()
    case 'md':
    case 'markdown':
      return markdown()
    case 'xml':
    case 'svg':
      return xml()
    default:
      return null
  }
}
