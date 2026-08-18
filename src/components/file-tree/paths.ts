import type { RemoteFsEntry } from '../../types'

export const INTERNAL_MOVE_MIME = 'application/x-customssh-paths'

export function parentChain(cwd: string): string[] {
  if (!cwd || cwd === '/') return ['/']
  const parts = cwd.split('/').filter(Boolean)
  const paths = ['/']
  let acc = ''
  for (const part of parts) {
    acc += `/${part}`
    paths.push(acc)
  }
  return paths
}

export function parentDir(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean)
  if (parts.length <= 1) return '/'
  return `/${parts.slice(0, -1).join('/')}`
}

export function joinRemote(dir: string, name: string): string {
  if (dir === '/') return `/${name}`
  return `${dir.replace(/\/+$/, '')}/${name}`
}

export function isRemoteDescendant(path: string, ancestor: string): boolean {
  if (ancestor === '/') return path !== '/'
  return path === ancestor || path.startsWith(`${ancestor}/`)
}

export function canMovePathsTo(sources: string[], targetDir: string): boolean {
  return sources.some((src) => {
    if (!src || src === '/') return false
    if (src === targetDir) return false
    if (isRemoteDescendant(targetDir, src)) return false
    return parentDir(src) !== targetDir
  })
}

export function displayName(path: string): string {
  if (path === '/') return 'root'
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || 'root'
}

export function normalizeRemotePath(input: string): string {
  const value = input.trim().replace(/\\/g, '/')
  if (!value || value === '/') return '/'
  const withSlash = value.startsWith('/') ? value : `/${value}`
  const parts = withSlash.split('/').filter(Boolean)
  return parts.length === 0 ? '/' : `/${parts.join('/')}`
}

export function scrollFolderToTop(
  container: HTMLElement | null,
  remotePath: string,
) {
  if (!container) return
  const row = Array.from(
    container.querySelectorAll<HTMLElement>('[data-tree-path]'),
  ).find((el) => el.getAttribute('data-tree-path') === remotePath)
  if (!row) return
  const containerTop = container.getBoundingClientRect().top
  const rowTop = row.getBoundingClientRect().top
  container.scrollTop += rowTop - containerTop
}

export function entryMatchesFilter(
  entry: RemoteFsEntry,
  query: string,
  childrenMap: Record<string, RemoteFsEntry[]>,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (entry.name.toLowerCase().includes(q)) return true
  if (!entry.isDir) return false
  const kids = childrenMap[entry.path]
  if (!kids) return false
  return kids.some((child) => entryMatchesFilter(child, q, childrenMap))
}
