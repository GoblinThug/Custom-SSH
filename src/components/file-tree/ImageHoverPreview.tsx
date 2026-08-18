import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RemoteFsEntry } from '../../types'
import { formatBytes, measureImage } from '../../imageFiles'

export const IMAGE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024
export const IMAGE_HOVER_DELAY_MS = 180

type CachedImagePreview = {
  src: string
  width: number
  height: number
  size: number
}

const imagePreviewCache = new Map<string, CachedImagePreview>()
const imagePreviewLoads = new Map<string, Promise<CachedImagePreview>>()

function imagePreviewKey(sessionId: string, remotePath: string) {
  return `${sessionId}:${remotePath}`
}

function loadImagePreview(
  sessionId: string,
  remotePath: string,
): Promise<CachedImagePreview> {
  const key = imagePreviewKey(sessionId, remotePath)
  const cached = imagePreviewCache.get(key)
  if (cached) return Promise.resolve(cached)
  const inflight = imagePreviewLoads.get(key)
  if (inflight) return inflight
  const request = window.sshApi
    .fsReadBinary(sessionId, remotePath)
    .then(async (file) => {
      const dims = await measureImage(file.base64, file.mimeType)
      const preview: CachedImagePreview = {
        src: `data:${file.mimeType};base64,${file.base64}`,
        width: dims.width,
        height: dims.height,
        size: file.size,
      }
      imagePreviewCache.set(key, preview)
      if (imagePreviewCache.size > 24) {
        const first = imagePreviewCache.keys().next().value
        if (first) imagePreviewCache.delete(first)
      }
      return preview
    })
    .finally(() => {
      imagePreviewLoads.delete(key)
    })
  imagePreviewLoads.set(key, request)
  return request
}

export function ImageHoverPreview({
  sessionId,
  entry,
  anchor,
}: {
  sessionId: string
  entry: RemoteFsEntry
  anchor: DOMRect
}) {
  const [preview, setPreview] = useState<CachedImagePreview | null>(
    () => imagePreviewCache.get(imagePreviewKey(sessionId, entry.path)) ?? null,
  )
  const [failed, setFailed] = useState(false)
  const tooLarge =
    entry.size != null && entry.size > IMAGE_PREVIEW_MAX_BYTES

  useEffect(() => {
    if (tooLarge) return
    let cancelled = false
    void loadImagePreview(sessionId, entry.path)
      .then((next) => {
        if (!cancelled) setPreview(next)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [entry.path, sessionId, tooLarge])

  const cardWidth = 228
  const left = Math.max(8, anchor.left - cardWidth - 10)
  const top = Math.min(
    Math.max(8, anchor.top - 8),
    window.innerHeight - 280,
  )
  const meta = preview
    ? `${preview.width} × ${preview.height} · ${formatBytes(preview.size)}`
    : entry.size != null
      ? formatBytes(entry.size)
      : null

  return createPortal(
    <div
      className="file-tree__image-preview"
      style={{ left, top }}
      role="tooltip"
    >
      {preview ? (
        <div className="file-tree__image-preview-frame">
          <img
            className="file-tree__image-preview-img"
            src={preview.src}
            alt=""
          />
        </div>
      ) : (
        <div className="file-tree__image-preview-frame is-empty">
          {tooLarge || failed ? '—' : '…'}
        </div>
      )}
      <div className="file-tree__image-preview-meta">
        <div className="file-tree__image-preview-name">{entry.name}</div>
        {meta ? (
          <div className="file-tree__image-preview-size">{meta}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
