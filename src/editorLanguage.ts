import { StreamLanguage } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { fileExtension } from './editorSyntaxColors'

const cache = new Map<string, Extension>()

async function cached(key: string, load: () => Promise<Extension>): Promise<Extension> {
  const hit = cache.get(key)
  if (hit) return hit
  const ext = await load()
  cache.set(key, ext)
  return ext
}

/** Load a CodeMirror language extension for the given remote path (lazy, cached). */
export async function languageExtensionForPath(
  remotePath: string,
): Promise<Extension | null> {
  const ext = fileExtension(remotePath)

  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return cached('js', async () => {
        const { javascript } = await import('@codemirror/lang-javascript')
        return javascript({ jsx: true })
      })
    case 'ts':
    case 'tsx':
      return cached('ts', async () => {
        const { javascript } = await import('@codemirror/lang-javascript')
        return javascript({ jsx: true, typescript: true })
      })
    case 'json':
    case 'jsonc':
    case 'json5':
      return cached('json', async () => {
        const { json } = await import('@codemirror/lang-json')
        return json()
      })
    case 'yml':
    case 'yaml':
      return cached('yaml', async () => {
        const { yaml } = await import('@codemirror/lang-yaml')
        return yaml()
      })
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'bat':
    case 'cmd':
      return cached('shell', async () => {
        const { shell } = await import('@codemirror/legacy-modes/mode/shell')
        return StreamLanguage.define(shell)
      })
    case 'ps1':
      return cached('ps1', async () => {
        const { powerShell } = await import(
          '@codemirror/legacy-modes/mode/powershell'
        )
        return StreamLanguage.define(powerShell)
      })
    case 'properties':
    case 'props':
    case 'ini':
    case 'env':
    case 'conf':
    case 'config':
    case 'cfg':
      return cached('properties', async () => {
        const { properties } = await import(
          '@codemirror/legacy-modes/mode/properties'
        )
        return StreamLanguage.define(properties)
      })
    case 'html':
    case 'htm':
      return cached('html', async () => {
        const { html } = await import('@codemirror/lang-html')
        return html()
      })
    case 'css':
    case 'scss':
    case 'less':
      return cached('css', async () => {
        const { css } = await import('@codemirror/lang-css')
        return css()
      })
    case 'py':
      return cached('py', async () => {
        const { python } = await import('@codemirror/lang-python')
        return python()
      })
    case 'md':
    case 'markdown':
      return cached('md', async () => {
        const { markdown } = await import('@codemirror/lang-markdown')
        return markdown()
      })
    case 'xml':
    case 'svg':
      return cached('xml', async () => {
        const { xml } = await import('@codemirror/lang-xml')
        return xml()
      })
    default:
      return null
  }
}
