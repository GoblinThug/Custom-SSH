import type { ConnectionFolder, SavedConnection } from '../types'
import type { ImportResult } from './types'

const PW_MAGIC = 0xa3
const PW_FLAG = 0xff

function decNextChar(bytes: number[]): number {
  if (bytes.length < 2) return 0
  const a = bytes.shift()!
  const b = bytes.shift()!
  return (~(((a << 4) + b) ^ PW_MAGIC)) & 0xff
}

/** Decode WinSCP obfuscated password (not strong crypto). */
export function decryptWinScpPassword(
  encoded: string,
  username: string,
  host: string,
): string {
  if (!encoded) return ''
  const nibbles: number[] = []
  for (const ch of encoded.trim()) {
    const n = Number.parseInt(ch, 16)
    if (Number.isNaN(n)) continue
    nibbles.push(n)
  }
  if (nibbles.length < 4) return ''

  const flag = decNextChar(nibbles)
  let length = 0
  if (flag === PW_FLAG) {
    decNextChar(nibbles) // version / unused in simple path
    length = decNextChar(nibbles)
  } else {
    length = flag
  }

  const skip = decNextChar(nibbles)
  for (let i = 0; i < skip * 2 && nibbles.length > 0; i += 1) {
    nibbles.shift()
  }

  let clear = ''
  for (let i = 0; i < length && nibbles.length >= 2; i += 1) {
    clear += String.fromCharCode(decNextChar(nibbles))
  }

  if (flag === PW_FLAG) {
    const key = `${username}${host}`
    if (clear.toLowerCase().startsWith(key.toLowerCase())) {
      clear = clear.slice(key.length)
    }
  }
  return clear
}

function parseIniSections(text: string): Map<string, Record<string, string>> {
  const sections = new Map<string, Record<string, string>>()
  let current: string | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const sectionMatch = line.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      current = sectionMatch[1]
      if (!sections.has(current)) sections.set(current, {})
      continue
    }
    if (!current) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1)
    sections.get(current)![key] = value
  }
  return sections
}

export function importWinScpIni(
  text: string,
  makeId: () => string,
  now: string,
): ImportResult {
  const sections = parseIniSections(text)
  const folders: ConnectionFolder[] = []
  const folderByPath = new Map<string, string>()
  const connections: SavedConnection[] = []

  for (const [name, values] of sections) {
    const sessionKey = name.replace(/^sessions\\/i, '')
    if (!sessionKey || sessionKey.toLowerCase() === 'default%20settings') continue
    if (!values.HostName && !values.hostname) continue

    const host = (values.HostName || values.hostname || '').trim()
    if (!host) continue

    const username = (values.UserName || values.username || '').trim()
    const portRaw = values.PortNumber || values.portnumber || '22'
    const port = Math.min(65535, Math.max(1, Number.parseInt(portRaw, 10) || 22))
    const keyPath = (values.PublicKeyFile || values.privatekeyfile || '').trim()
    const encodedPass = values.Password || values.password || ''
    const password = encodedPass
      ? decryptWinScpPassword(encodedPass, username, host)
      : undefined

    const parts = sessionKey.split('\\').filter(Boolean)
    const siteName = decodeURIComponent(parts[parts.length - 1] || host)
    let folderId: string | null = null
    if (parts.length > 1) {
      const folderPath = parts.slice(0, -1).join('/')
      let parent: string | null = null
      const segments: string[] = []
      for (const segment of parts.slice(0, -1)) {
        segments.push(decodeURIComponent(segment))
        const pathKey = segments.join('/')
        let id = folderByPath.get(pathKey)
        if (!id) {
          id = makeId()
          folderByPath.set(pathKey, id)
          folders.push({
            id,
            name: segments[segments.length - 1],
            color: 'blue',
            createdAt: now,
            updatedAt: now,
          })
        }
        parent = id
        void parent
      }
      folderId = folderByPath.get(folderPath) ?? null
    }

    const authMethod = keyPath ? 'privateKey' : 'password'
    connections.push({
      id: makeId(),
      name: siteName,
      host,
      port,
      username: username || 'root',
      authMethod,
      password: authMethod === 'password' ? password || undefined : undefined,
      privateKeyPath: keyPath || undefined,
      folderId,
      createdAt: now,
      updatedAt: now,
    })
  }

  return { folders, connections }
}
