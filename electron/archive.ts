import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import zlib from 'node:zlib'
import { openPromise } from 'yauzl'

export type ArchiveKind = 'zip' | 'tar' | 'tgz' | 'gz' | 'rar'

export type ArchiveListEntry = {
  path: string
  name: string
  isDir: boolean
  size: number
}

function archiveBaseName(name: string): string {
  const trimmed = name.trim().replace(/\\/g, '/')
  return trimmed.split('/').filter(Boolean).pop() || trimmed
}

export function isArchiveName(name: string): boolean {
  const lower = archiveBaseName(name).toLowerCase()
  if (
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tar.bz2') ||
    lower.endsWith('.tar.xz') ||
    lower.endsWith('.tar.zst')
  ) {
    return true
  }
  return /\.(zip|zipx|jar|war|ear|apk|rar|7z|tar|tgz|gz|bz2|xz|zst|tbz2?|txz)$/i.test(
    lower,
  )
}

export function archiveKindFromName(name: string): ArchiveKind | null {
  const lower = archiveBaseName(name).toLowerCase()
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tgz'
  if (lower.endsWith('.tar')) return 'tar'
  if (lower.endsWith('.gz')) return 'gz'
  if (/\.(zip|zipx|jar|war|ear|apk)$/i.test(lower)) return 'zip'
  if (lower.endsWith('.rar')) return 'rar'
  return null
}

function posixNorm(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

function fileNameOf(entryPath: string): string {
  const parts = posixNorm(entryPath).split('/').filter(Boolean)
  return parts[parts.length - 1] || entryPath
}

function parentOf(entryPath: string): string {
  const parts = posixNorm(entryPath).split('/').filter(Boolean)
  return parts.slice(0, -1).join('/')
}

function ensureSafeDest(root: string, entryPath: string): string {
  const dest = path.resolve(root, ...posixNorm(entryPath).split('/'))
  const base = path.resolve(root)
  if (dest !== base && !dest.startsWith(`${base}${path.sep}`)) {
    throw new Error('Invalid archive path')
  }
  return dest
}

function isWanted(entryPath: string, wanted: Set<string>): boolean {
  if (wanted.size === 0) return true
  if (wanted.has(entryPath)) return true
  for (const prefix of wanted) {
    if (prefix && entryPath.startsWith(`${prefix}/`)) return true
  }
  return false
}

function withImpliedDirs(entries: ArchiveListEntry[]): ArchiveListEntry[] {
  const map = new Map<string, ArchiveListEntry>()
  for (const entry of entries) {
    const key = posixNorm(entry.path)
    if (!key) continue
    map.set(key, { ...entry, path: key })
    let parent = parentOf(key)
    while (parent) {
      if (!map.has(parent)) {
        map.set(parent, {
          path: parent,
          name: fileNameOf(parent),
          isDir: true,
          size: 0,
        })
      }
      parent = parentOf(parent)
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

function parseOctal(buf: Buffer, start: number, length: number): number {
  const raw = buf.toString('utf8', start, start + length).replace(/\0.*$/, '').trim()
  if (!raw) return 0
  const value = Number.parseInt(raw, 8)
  return Number.isFinite(value) ? value : 0
}

function parseTar(buffer: Buffer): ArchiveListEntry[] {
  const entries: ArchiveListEntry[] = []
  let offset = 0
  let pendingLongName: string | null = null

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    offset += 512
    if (header.every((byte) => byte === 0)) break

    const size = parseOctal(header, 124, 12)
    const type = String.fromCharCode(header[156] || 0)
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '').trim()
    const nameField = header.toString('utf8', 0, 100).replace(/\0.*$/, '').trim()
    let name = pendingLongName || (prefix ? `${prefix}/${nameField}` : nameField)
    pendingLongName = null

    const dataEnd = offset + size
    const padded = Math.ceil(size / 512) * 512
    const data = buffer.subarray(offset, Math.min(dataEnd, buffer.length))
    offset += padded

    if (type === 'L' || type === 'K') {
      pendingLongName = data.toString('utf8').replace(/\0.*$/, '').trim()
      continue
    }
    if (!name || type === 'g' || type === 'x' || type === '1' || type === '2') {
      continue
    }

    const isDir = type === '5' || name.endsWith('/')
    entries.push({
      path: posixNorm(name),
      name: fileNameOf(name),
      isDir,
      size: isDir ? 0 : size,
    })
  }

  return withImpliedDirs(entries)
}

async function listZip(filePath: string): Promise<ArchiveListEntry[]> {
  const zip = await openPromise(filePath, { autoClose: true })
  const entries: ArchiveListEntry[] = []
  for await (const entry of zip.eachEntry()) {
    const name = posixNorm(entry.fileName)
    if (!name) continue
    const isDir = /\/$/.test(entry.fileName.replace(/\\/g, '/'))
    entries.push({
      path: name,
      name: fileNameOf(name),
      isDir,
      size: isDir ? 0 : entry.uncompressedSize,
    })
  }
  return withImpliedDirs(entries)
}

type RarFileHeader = {
  name: string
  unpSize: number
  flags: { directory: boolean }
}

type RarExtractor = {
  getFileList: () => { fileHeaders: Iterable<RarFileHeader> }
}

type RarExtractedFile = {
  fileHeader: RarFileHeader
  extraction?: Uint8Array
}

function unrarModule() {
  const req = createRequire(__filename)
  return req('node-unrar-js') as {
    createExtractorFromFile: (opts: {
      filepath: string
      wasmBinary?: ArrayBuffer
    }) => Promise<RarExtractor>
    createExtractorFromData: (opts: {
      data: ArrayBuffer
      wasmBinary?: ArrayBuffer
    }) => Promise<{
      extract: (opts?: {
        files?: (header: RarFileHeader) => boolean
      }) => { files: Iterable<RarExtractedFile> }
    }>
  }
}

function loadUnrarWasm(): ArrayBuffer {
  const req = createRequire(__filename)
  const wasmPath = path.join(
    path.dirname(req.resolve('node-unrar-js')),
    'js',
    'unrar.wasm',
  )
  const buf = fs.readFileSync(wasmPath)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

async function withMutedStdio<T>(fn: () => Promise<T>): Promise<T> {
  const stdout = process.stdout.write.bind(process.stdout)
  const stderr = process.stderr.write.bind(process.stderr)
  const mute = ((
    _chunk: unknown,
    encoding?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ) => {
    if (typeof encoding === 'function') encoding()
    else if (typeof cb === 'function') cb()
    return true
  }) as typeof process.stdout.write
  process.stdout.write = mute
  process.stderr.write = mute
  try {
    return await fn()
  } finally {
    process.stdout.write = stdout
    process.stderr.write = stderr
  }
}

function rethrowRar(err: unknown): never {
  const reason =
    typeof err === 'object' && err && 'reason' in err
      ? String((err as { reason: unknown }).reason)
      : ''
  const message = err instanceof Error ? err.message : String(err)
  if (/password/i.test(reason) || /password/i.test(message)) {
    throw new Error('ERAR_MISSING_PASSWORD')
  }
  throw err
}

async function createRarExtractor(filePath: string): Promise<RarExtractor> {
  const { createExtractorFromFile } = unrarModule()
  return withMutedStdio(() =>
    createExtractorFromFile({
      filepath: filePath,
      wasmBinary: loadUnrarWasm(),
    }),
  )
}

async function listRar(filePath: string): Promise<ArchiveListEntry[]> {
  try {
    const extractor = await createRarExtractor(filePath)
    const entries: ArchiveListEntry[] = []
    for (const header of extractor.getFileList().fileHeaders) {
      const name = posixNorm(header.name)
      if (!name) continue
      entries.push({
        path: name,
        name: fileNameOf(name),
        isDir: Boolean(header.flags.directory) || header.name.endsWith('/'),
        size: header.flags.directory ? 0 : header.unpSize,
      })
    }
    return withImpliedDirs(entries)
  } catch (err) {
    rethrowRar(err)
  }
}

async function extractRarEntries(
  filePath: string,
  wanted: Set<string>,
  destDir: string,
): Promise<number> {
  try {
    const raw = fs.readFileSync(filePath)
    const { createExtractorFromData } = unrarModule()
    const extractor = await withMutedStdio(() =>
      createExtractorFromData({
        data: raw.buffer.slice(
          raw.byteOffset,
          raw.byteOffset + raw.byteLength,
        ),
        wasmBinary: loadUnrarWasm(),
      }),
    )
    const result = extractor.extract({
      files:
        wanted.size === 0
          ? undefined
          : (header) => isWanted(posixNorm(header.name), wanted),
    })
    let written = 0
    for (const file of result.files) {
      const name = posixNorm(file.fileHeader.name)
      if (!name || (wanted.size > 0 && !isWanted(name, wanted))) continue
      const dest = ensureSafeDest(destDir, name)
      if (file.fileHeader.flags.directory || file.fileHeader.name.endsWith('/')) {
        fs.mkdirSync(dest, { recursive: true })
        written += 1
        continue
      }
      if (!file.extraction) continue
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, Buffer.from(file.extraction))
      written += 1
    }
    return written
  } catch (err) {
    rethrowRar(err)
  }
}

export async function listArchiveFile(
  filePath: string,
  kind: ArchiveKind,
): Promise<ArchiveListEntry[]> {
  if (kind === 'zip') return listZip(filePath)
  if (kind === 'rar') return listRar(filePath)
  if (kind === 'gz') {
    const base = path.basename(filePath).replace(/\.gz$/i, '') || 'file'
    const size = fs.statSync(filePath).size
    return [{ path: base, name: base, isDir: false, size }]
  }

  const raw = fs.readFileSync(filePath)
  const tarBuf = kind === 'tgz' ? zlib.gunzipSync(raw) : raw
  return parseTar(tarBuf)
}

function extractTarEntries(
  buffer: Buffer,
  wanted: Set<string>,
  destDir: string,
): number {
  let offset = 0
  let pendingLongName: string | null = null
  let written = 0

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    offset += 512
    if (header.every((byte) => byte === 0)) break

    const size = parseOctal(header, 124, 12)
    const type = String.fromCharCode(header[156] || 0)
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '').trim()
    const nameField = header.toString('utf8', 0, 100).replace(/\0.*$/, '').trim()
    let name = pendingLongName || (prefix ? `${prefix}/${nameField}` : nameField)
    pendingLongName = null

    const dataEnd = offset + size
    const padded = Math.ceil(size / 512) * 512
    const data = buffer.subarray(offset, Math.min(dataEnd, buffer.length))
    offset += padded

    if (type === 'L' || type === 'K') {
      pendingLongName = data.toString('utf8').replace(/\0.*$/, '').trim()
      continue
    }

    const entryPath = posixNorm(name)
    if (!entryPath || !isWanted(entryPath, wanted)) continue

    const isDir = type === '5' || name.endsWith('/')
    const dest = ensureSafeDest(destDir, entryPath)
    if (isDir) {
      fs.mkdirSync(dest, { recursive: true })
      written += 1
      continue
    }
    if (type !== '0' && type !== '\0' && type !== '7' && type !== '') continue
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, data)
    written += 1
  }

  return written
}

async function extractZipEntries(
  filePath: string,
  wanted: Set<string>,
  destDir: string,
): Promise<number> {
  const zip = await openPromise(filePath, { autoClose: true })
  let written = 0
  for await (const entry of zip.eachEntry()) {
    const name = posixNorm(entry.fileName)
    const isDir = /\/$/.test(entry.fileName.replace(/\\/g, '/'))
    if (!name || !isWanted(name, wanted)) continue
    const dest = ensureSafeDest(destDir, name)
    if (isDir) {
      fs.mkdirSync(dest, { recursive: true })
      written += 1
      continue
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const stream = await zip.openReadStreamPromise(entry)
    await pipeline(stream, fs.createWriteStream(dest))
    written += 1
  }
  return written
}

export async function extractArchiveFile(
  filePath: string,
  kind: ArchiveKind,
  paths: string[] | null,
  destDir: string,
): Promise<number> {
  const wanted = new Set((paths ?? []).map(posixNorm).filter(Boolean))
  fs.mkdirSync(destDir, { recursive: true })

  if (kind === 'zip') return extractZipEntries(filePath, wanted, destDir)
  if (kind === 'rar') return extractRarEntries(filePath, wanted, destDir)

  if (kind === 'gz') {
    const base = path.basename(filePath).replace(/\.gz$/i, '') || 'file'
    if (wanted.size > 0 && !wanted.has(base) && !wanted.has(posixNorm(base))) {
      return 0
    }
    const dest = ensureSafeDest(destDir, base)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const unzipped = zlib.gunzipSync(fs.readFileSync(filePath))
    fs.writeFileSync(dest, unzipped)
    return 1
  }

  const raw = fs.readFileSync(filePath)
  const tarBuf = kind === 'tgz' ? zlib.gunzipSync(raw) : raw
  return extractTarEntries(tarBuf, wanted, destDir)
}
