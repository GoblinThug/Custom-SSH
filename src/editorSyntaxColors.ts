import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

const highlightDark = HighlightStyle.define([
  { tag: t.propertyName, color: '#7dd3fc', fontWeight: '600' },
  { tag: t.definition(t.propertyName), color: '#7dd3fc', fontWeight: '600' },
  { tag: t.attributeName, color: '#7dd3fc', fontWeight: '600' },
  { tag: t.variableName, color: '#67e8f9' },
  { tag: t.definition(t.variableName), color: '#67e8f9' },
  { tag: t.string, color: '#86efac' },
  { tag: t.special(t.string), color: '#6ee7b7' },
  { tag: t.number, color: '#fdba74' },
  { tag: t.bool, color: '#c4b5fd' },
  { tag: t.null, color: '#f9a8d4' },
  { tag: t.atom, color: '#c4b5fd' },
  { tag: t.keyword, color: '#f472b6' },
  { tag: t.operatorKeyword, color: '#f472b6' },
  { tag: t.modifier, color: '#f472b6' },
  { tag: t.comment, color: '#94a3b8', fontStyle: 'italic' },
  { tag: t.lineComment, color: '#94a3b8', fontStyle: 'italic' },
  { tag: t.blockComment, color: '#94a3b8', fontStyle: 'italic' },
  { tag: t.meta, color: '#a5b4fc' },
  { tag: t.processingInstruction, color: '#a5b4fc' },
  { tag: t.punctuation, color: '#94a3b8' },
  { tag: t.squareBracket, color: '#fde047' },
  { tag: t.brace, color: '#fde047' },
  { tag: t.paren, color: '#fde047' },
  { tag: t.separator, color: '#94a3b8' },
  { tag: t.operator, color: '#fbbf24' },
  { tag: t.labelName, color: '#fda4af' },
  { tag: t.name, color: '#93c5fd' },
  { tag: t.typeName, color: '#fcd34d' },
])

const highlightLight = HighlightStyle.define([
  { tag: t.propertyName, color: '#0369a1', fontWeight: '600' },
  { tag: t.definition(t.propertyName), color: '#0369a1', fontWeight: '600' },
  { tag: t.attributeName, color: '#0369a1', fontWeight: '600' },
  { tag: t.variableName, color: '#0e7490' },
  { tag: t.definition(t.variableName), color: '#0e7490' },
  { tag: t.string, color: '#15803d' },
  { tag: t.special(t.string), color: '#166534' },
  { tag: t.number, color: '#c2410c' },
  { tag: t.bool, color: '#6d28d9' },
  { tag: t.null, color: '#be185d' },
  { tag: t.atom, color: '#6d28d9' },
  { tag: t.keyword, color: '#be185d' },
  { tag: t.operatorKeyword, color: '#be185d' },
  { tag: t.modifier, color: '#be185d' },
  { tag: t.comment, color: '#64748b', fontStyle: 'italic' },
  { tag: t.lineComment, color: '#64748b', fontStyle: 'italic' },
  { tag: t.blockComment, color: '#64748b', fontStyle: 'italic' },
  { tag: t.meta, color: '#4338ca' },
  { tag: t.processingInstruction, color: '#4338ca' },
  { tag: t.punctuation, color: '#64748b' },
  { tag: t.squareBracket, color: '#a16207' },
  { tag: t.brace, color: '#a16207' },
  { tag: t.paren, color: '#a16207' },
  { tag: t.separator, color: '#64748b' },
  { tag: t.operator, color: '#b45309' },
  { tag: t.labelName, color: '#9f1239' },
  { tag: t.name, color: '#1d4ed8' },
  { tag: t.typeName, color: '#a16207' },
])

const COLORED_EXTS = new Set([
  'json',
  'jsonc',
  'json5',
  'yml',
  'yaml',
  'sh',
  'bash',
  'zsh',
  'bat',
  'cmd',
  'ps1',
  'properties',
  'props',
  'ini',
  'env',
  'conf',
  'config',
  'cfg',
])

export function fileExtension(remotePath: string): string {
  const name = remotePath.split('/').pop()?.toLowerCase() ?? ''
  if (name.startsWith('.') && !name.slice(1).includes('.')) {
    // e.g. .env
    return name.slice(1)
  }
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
}

export function wantsColorHighlight(remotePath: string): boolean {
  return COLORED_EXTS.has(fileExtension(remotePath))
}

export function syntaxColorExtension(theme: 'dark' | 'light'): Extension {
  return syntaxHighlighting(theme === 'light' ? highlightLight : highlightDark)
}
