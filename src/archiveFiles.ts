function archiveBaseName(name: string): string {
  const trimmed = name.trim().replace(/\\/g, '/')
  return trimmed.split('/').filter(Boolean).pop() || trimmed
}

export function isArchiveFile(name: string): boolean {
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
