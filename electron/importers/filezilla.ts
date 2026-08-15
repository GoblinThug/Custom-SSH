import type { ConnectionFolder, SavedConnection } from '../types'
import type { ImportResult } from './types'

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function tagValue(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')
  const match = block.match(re)
  return match ? decodeEntities(match[1].trim()) : ''
}

function tagAttr(block: string, tag: string, attr: string): string {
  const open = block.match(new RegExp(`<${tag}([^>]*)>`, 'i'))
  if (!open) return ''
  const attrMatch = open[1].match(new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, 'i'))
  return attrMatch ? decodeEntities(attrMatch[1]) : ''
}

function decodePass(block: string): string {
  const encoding = tagAttr(block, 'Pass', 'encoding').toLowerCase()
  const raw = tagValue(block, 'Pass')
  if (!raw) return ''
  if (encoding === 'base64') {
    try {
      return Buffer.from(raw, 'base64').toString('utf8')
    } catch {
      return raw
    }
  }
  return raw
}

/** FileZilla Protocol: 0=FTP, 1=SFTP, 3=FTPS, … — import SFTP / SSH-like. */
function isSshProtocol(protocol: string): boolean {
  const n = Number.parseInt(protocol, 10)
  return n === 1 || protocol.toLowerCase() === 'sftp'
}

export function importFileZillaXml(
  text: string,
  makeId: () => string,
  now: string,
): ImportResult {
  const folders: ConnectionFolder[] = []
  const connections: SavedConnection[] = []
  const serverBlocks = text.match(/<Server\b[\s\S]*?<\/Server>/gi) ?? []
  const folderByName = new Map<string, string>()

  for (const block of serverBlocks) {
    const protocol = tagValue(block, 'Protocol') || '0'
    if (!isSshProtocol(protocol)) continue

    const host = tagValue(block, 'Host')
    if (!host) continue

    const name = tagValue(block, 'Name') || host
    const username = tagValue(block, 'User') || 'root'
    const port = Math.min(
      65535,
      Math.max(1, Number.parseInt(tagValue(block, 'Port') || '22', 10) || 22),
    )
    const password = decodePass(block) || undefined
    const keyPath =
      tagValue(block, 'Keyfile') ||
      tagValue(block, 'LocalDir') ||
      undefined

    // FileZilla may nest Name as "Folder/Site"
    const parts = name.split('/').map((p) => p.trim()).filter(Boolean)
    const siteName = parts[parts.length - 1] || host
    let folderId: string | null = null
    if (parts.length > 1) {
      const folderName = parts.slice(0, -1).join(' / ')
      let id = folderByName.get(folderName)
      if (!id) {
        id = makeId()
        folderByName.set(folderName, id)
        folders.push({
          id,
          name: folderName,
          color: 'teal',
          createdAt: now,
          updatedAt: now,
        })
      }
      folderId = id
    }

    const hasKey = Boolean(
      keyPath && (keyPath.includes('\\') || keyPath.includes('/')),
    )
    connections.push({
      id: makeId(),
      name: siteName,
      host,
      port,
      username,
      authMethod: hasKey && !password ? 'privateKey' : 'password',
      password,
      privateKeyPath: hasKey ? keyPath : undefined,
      folderId,
      createdAt: now,
      updatedAt: now,
    })
  }

  return { folders, connections }
}
