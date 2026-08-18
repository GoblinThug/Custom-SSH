import type { ConnectionFolder, SavedConnection } from '../types'
import type { ImportResult } from './types'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

function asRecord(value: Json): Record<string, Json> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, Json>
}

function asString(value: Json | undefined): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: Json | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value, 10)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function pickHost(obj: Record<string, Json>): string {
  return (
    asString(obj.address) ||
    asString(obj.hostname) ||
    asString(obj.host) ||
    asString(obj.ip) ||
    ''
  )
}

function pickName(obj: Record<string, Json>, host: string): string {
  return (
    asString(obj.label) ||
    asString(obj.title) ||
    asString(obj.name) ||
    asString(obj.group_name) ||
    host
  )
}

function pickUsername(obj: Record<string, Json>): string {
  const creds = asRecord(obj.credentials)
  return (
    asString(obj.username) ||
    asString(obj.user) ||
    (creds ? asString(creds.username) || asString(creds.user) : '') ||
    'root'
  )
}

function pickPassword(obj: Record<string, Json>): string | undefined {
  const creds = asRecord(obj.credentials)
  const password =
    asString(obj.password) ||
    (creds ? asString(creds.password) : '') ||
    ''
  return password || undefined
}

function pickKeyPath(obj: Record<string, Json>): string | undefined {
  const creds = asRecord(obj.credentials)
  const path =
    asString(obj.ssh_key_path) ||
    asString(obj.privateKeyPath) ||
    asString(obj.private_key) ||
    (creds
      ? asString(creds.ssh_key_path) || asString(creds.private_key)
      : '') ||
    ''
  // Ignore inline key bodies; we only store filesystem paths.
  if (!path || path.includes('BEGIN') || path.length > 400) return undefined
  return path
}

function pickGroup(obj: Record<string, Json>): string {
  return (
    asString(obj.group) ||
    asString(obj.group_name) ||
    asString(obj.folder) ||
    ''
  )
}

function collectHostObjects(root: Json): Record<string, Json>[] {
  const out: Record<string, Json>[] = []
  const seen = new Set<Record<string, Json>>()

  const visit = (node: Json) => {
    if (!node) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    const obj = asRecord(node)
    if (!obj) return

    const host = pickHost(obj)
    if (host && !seen.has(obj)) {
      // Heuristic: looks like a host entry
      if (
        'address' in obj ||
        'hostname' in obj ||
        'host' in obj ||
        ('port' in obj && ('username' in obj || 'credentials' in obj))
      ) {
        seen.add(obj)
        out.push(obj)
      }
    }

    for (const key of [
      'hosts',
      'servers',
      'connections',
      'items',
      'data',
      'groups',
    ]) {
      if (key in obj) visit(obj[key])
    }
  }

  visit(root)
  return out
}

export function importTermiusJson(
  text: string,
  makeId: () => string,
  now: string,
): ImportResult {
  let parsed: Json
  try {
    parsed = JSON.parse(text) as Json
  } catch {
    throw new Error('Invalid Termius JSON')
  }

  const hosts = collectHostObjects(parsed)
  const folders: ConnectionFolder[] = []
  const folderByName = new Map<string, string>()
  const connections: SavedConnection[] = []

  for (const obj of hosts) {
    const host = pickHost(obj).trim()
    if (!host) continue

    const username = pickUsername(obj).trim() || 'root'
    const port = Math.min(65535, Math.max(1, asNumber(obj.port, 22)))
    const password = pickPassword(obj)
    const keyPath = pickKeyPath(obj)
    const group = pickGroup(obj).trim()
    const name = pickName(obj, host).trim() || host

    let folderId: string | null = null
    if (group) {
      let id = folderByName.get(group)
      if (!id) {
        id = makeId()
        folderByName.set(group, id)
        folders.push({
          id,
          name: group,
          color: 'purple',
          createdAt: now,
          updatedAt: now,
        })
      }
      folderId = id
    }

    connections.push({
      id: makeId(),
      name,
      host,
      port,
      username,
      authMethod: keyPath && !password ? 'privateKey' : 'password',
      password,
      privateKeyPath: keyPath,
      folderId,
      protocol: 'ssh',
      createdAt: now,
      updatedAt: now,
    })
  }

  return { folders, connections }
}
