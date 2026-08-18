import { useCallback, useEffect, useRef, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { ProgressBar } from './components/ProgressBar'
import { useSettings } from './i18n/SettingsContext'
import { formatAppError } from './utils/formatAppError'
import { readWindowQuery } from './utils/windowQuery'
import { formatBytes } from './imageFiles'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function DownloadIcon() {
  return (
    <svg
      className="btn-icon__svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M12 3v10m0 0l-3.5-3.5M12 13l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 16.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function FullscreenIcon({ active }: { active: boolean }) {
  return (
    <svg
      className="btn-icon__svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      {active ? (
        <path
          d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M8 3H4v4M16 3h4v4M8 21H4v-4M16 21h4v-4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

export function ViewerApp() {
  const { t } = useSettings()
  const [sessionId, setSessionId] = useState(() => readWindowQuery().sessionId)
  const [remotePath, setRemotePath] = useState(() => readWindowQuery().remotePath)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [src, setSrc] = useState<string>()
  const [fileSize, setFileSize] = useState<number>()
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [scale, setScale] = useState(1)
  const [animateScale, setAnimateScale] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [panning, setPanning] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  const fileName = remotePath.split('/').filter(Boolean).pop() || remotePath
  const isSvg = /\.svg$/i.test(remotePath)

  const load = useCallback(async () => {
    if (!sessionId || !remotePath) {
      setError(t('editorMissingParams'))
      setLoading(false)
      return
    }
    setLoading(true)
    setError(undefined)
    setSrc(undefined)
    setFileSize(undefined)
    setNatural(null)
    scaleRef.current = 1
    panRef.current = { x: 0, y: 0 }
    setScale(1)
    setPan({ x: 0, y: 0 })
    setAnimateScale(false)
    const name = remotePath.split('/').filter(Boolean).pop() || remotePath
    try {
      const file = await window.sshApi.fsReadBinary(sessionId, remotePath)
      setSrc(`data:${file.mimeType};base64,${file.base64}`)
      setFileSize(file.size)
      document.title = `${name} — Custom SSH`
    } catch (err) {
      setError(formatAppError(err, t, 'viewerLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [remotePath, sessionId, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    return window.sshApi.onViewerNavigate(({ sessionId: nextSessionId, remotePath: nextPath }) => {
      setSessionId(nextSessionId)
      setRemotePath(nextPath)
    })
  }, [])

  useEffect(() => {
    return window.sshApi.onViewerCloseRequest(() => {
      void window.sshApi.windowForceClose()
    })
  }, [])

  useEffect(() => {
    return window.sshApi.onWindowState((state) => {
      setFullscreen(state.fullscreen)
    })
  }, [])

  useEffect(() => {
    void window.sshApi.windowIsFullscreen().then(setFullscreen)
  }, [])

  const fitToView = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport || !natural) return
    const pad = 32
    const availW = Math.max(1, viewport.clientWidth - pad)
    const availH = Math.max(1, viewport.clientHeight - pad)
    const next = clamp(
      Math.min(availW / natural.w, availH / natural.h, 1),
      0.05,
      5,
    )
    scaleRef.current = next
    panRef.current = { x: 0, y: 0 }
    setPan({ x: 0, y: 0 })
    setScale(next)
  }, [natural])

  useEffect(() => {
    if (!natural) return
    setAnimateScale(false)
    fitToView()
    const id = window.requestAnimationFrame(() => setAnimateScale(true))
    return () => window.cancelAnimationFrame(id)
  }, [natural, fitToView])

  const zoomTo = (next: number) => {
    const clamped = clamp(next, 0.05, 8)
    scaleRef.current = clamped
    setAnimateScale(true)
    setScale(clamped)
  }

  const zoomBy = (delta: number) => {
    zoomTo(Number((scaleRef.current + delta).toFixed(2)))
  }

  const movePan = (x: number, y: number) => {
    const next = { x, y }
    panRef.current = next
    setPan(next)
  }

  const onWheel = (event: React.WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
      zoomTo(Number((scaleRef.current * factor).toFixed(3)))
      return
    }
    if (event.shiftKey) {
      event.preventDefault()
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY
      movePan(panRef.current.x - delta, panRef.current.y)
    }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || loading || !src) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: panRef.current.x,
      originY: panRef.current.y,
    }
    setPanning(true)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    movePan(
      drag.originX + (event.clientX - drag.startX),
      drag.originY + (event.clientY - drag.startY),
    )
  }

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setPanning(false)
  }

  const download = async () => {
    if (!sessionId || downloading) return
    setDownloading(true)
    try {
      await window.sshApi.fsDownload(sessionId, remotePath)
    } catch (err) {
      setError(formatAppError(err, t, 'fileDownloadFailed'))
    } finally {
      setDownloading(false)
    }
  }

  const toggleFullscreen = () => {
    void window.sshApi.windowFullscreenToggle()
  }

  const scaleLabel = `${Math.round(scale * 100)}%`

  return (
    <div className="app viewer-app">
      <TitleBar onClose={() => void window.sshApi.windowForceClose()} />
      <div className="viewer-shell">
        <div
          ref={viewportRef}
          className={`viewer-body${panning ? ' is-panning' : ''}`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        >
          {error ? <div className="error-box viewer-error">{error}</div> : null}
          {loading ? (
            <div className="viewer-loading">
              <ProgressBar indeterminate label={t('loading')} />
            </div>
          ) : src ? (
            <div className="viewer-stage">
              <div
                className="viewer-pan"
                style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
              >
              <img
                className={`viewer-image${isSvg ? ' is-svg' : ''}${
                  animateScale ? ' is-animated' : ''
                }`}
                src={src}
                alt={fileName}
                draggable={false}
                style={{ transform: `scale(${scale})` }}
                onLoad={(event) => {
                  const img = event.currentTarget
                  setNatural({
                    w: img.naturalWidth,
                    h: img.naturalHeight,
                  })
                }}
              />
              </div>
            </div>
          ) : null}
        </div>

        <div className="viewer-toolbar">
          <div className="viewer-toolbar__meta">
            <div className="viewer-toolbar__name" title={remotePath}>
              {fileName}
            </div>
            <div className="viewer-toolbar__path" title={remotePath}>
              {remotePath}
              {natural || fileSize != null ? (
                <span className="viewer-toolbar__dims">
                  {[
                    natural ? `${natural.w} × ${natural.h}` : null,
                    fileSize != null ? formatBytes(fileSize) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              ) : null}
            </div>
          </div>
          <div className="viewer-toolbar__actions">
            <button
              type="button"
              className="btn btn-secondary btn-icon-text"
              title={t('viewerZoomOut')}
              aria-label={t('viewerZoomOut')}
              onClick={() => zoomBy(-0.25)}
              disabled={loading || !src}
            >
              −
            </button>
            <span className="viewer-toolbar__scale">{scaleLabel}</span>
            <button
              type="button"
              className="btn btn-secondary btn-icon-text"
              title={t('viewerZoomIn')}
              aria-label={t('viewerZoomIn')}
              onClick={() => zoomBy(0.25)}
              disabled={loading || !src}
            >
              +
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              title={t('viewerZoomReset')}
              onClick={() => zoomTo(1)}
              disabled={loading || !src}
            >
              {t('viewerZoomReset')}
            </button>
            <button
              type="button"
              className="btn-icon"
              title={t('viewerDownload')}
              aria-label={t('viewerDownload')}
              onClick={() => void download()}
              disabled={loading || downloading || !src}
            >
              <DownloadIcon />
            </button>
            <button
              type="button"
              className={`btn-icon${fullscreen ? ' is-active' : ''}`}
              title={
                fullscreen ? t('windowExitFullscreen') : t('viewerFullscreen')
              }
              aria-label={
                fullscreen ? t('windowExitFullscreen') : t('viewerFullscreen')
              }
              onClick={toggleFullscreen}
              disabled={loading}
            >
              <FullscreenIcon active={fullscreen} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
