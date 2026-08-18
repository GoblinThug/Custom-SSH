import fs from 'node:fs'

const src = fs.readFileSync('src/i18n/messages.ts', 'utf8')
const lines = src.split(/\r?\n/)
const keyStart = lines.findIndex((l) => l.startsWith('export type MessageKey'))
const enStart = lines.findIndex((l) => l === 'const en: Record<MessageKey, string> = {')
const ruStart = lines.findIndex((l) => l === 'const ru: Record<MessageKey, string> = {')
const catStart = lines.findIndex((l) => l.startsWith('const catalogs:'))
const keys = lines.slice(keyStart, enStart).join('\n')
const enBody = lines.slice(enStart + 1, ruStart - 1).join('\n').replace(/\n}\s*$/, '')
const ruBody = lines.slice(ruStart + 1, catStart - 1).join('\n').replace(/\n}\s*$/, '')

fs.mkdirSync('src/i18n/messages', { recursive: true })
fs.writeFileSync('src/i18n/messageKeys.ts', `${keys}\n`)
fs.writeFileSync(
  'src/i18n/messages/en.ts',
  `import type { MessageKey } from '../messageKeys'\n\nexport const en: Record<MessageKey, string> = {\n${enBody}\n}\n`,
)
fs.writeFileSync(
  'src/i18n/messages/ru.ts',
  `import type { MessageKey } from '../messageKeys'\n\nexport const ru: Record<MessageKey, string> = {\n${ruBody}\n}\n`,
)
console.log('split ok')
