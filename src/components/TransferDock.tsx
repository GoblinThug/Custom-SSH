import { useEffect, useMemo, useState } from 'react'
import { useSettings } from '../i18n/SettingsContext'
import { ChevronIcon } from './ChevronIcon'
import { ProgressBar } from './ProgressBar'

type FileStatus = 'pending' | 'active' | 'done' | 'cancelled'

type TransferFile = {
  key: string
  path: string
  status: FileStatus
}

type TransferBatch = {
  transferId: string
  mode: 'download' | 'upload'
  percent: number
  filesDone: number
  filesTotal: number
  filesCancelled: number
  files: TransferFile[]
  currentPath?: string
  finished: boolean
}

function formatMessage(
  template: string,
  values: Record<string, string | number>,
) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  )
}

function basename(remotePath: string): string {
  const parts = remotePath.split('/').filter(Boolean)
  return parts[parts.length - 1] || remotePath
}

export function TransferDock() {
  const { t } = useSettings()
  const [expanded, setExpanded] = useState(false)
  const [batches, setBatches] = useState<TransferBatch[]>([])
  const [queuedUploads, setQueuedUploads] = useState(0)

  useEffect(() => {
    const apply = (
      mode: 'download' | 'upload',
      progress: {
        transferId: string
        percent: number
        currentPath?: string
        filesDone: number
        filesTotal: number
        filesCancelled: number
        files: TransferFile[]
      },
    ) => {
      if (!progress.transferId) return
      setBatches((prev) => {
        const finished =
          progress.filesTotal > 0 &&
          progress.filesDone + progress.filesCancelled >= progress.filesTotal
        const next: TransferBatch = {
          transferId: progress.transferId,
          mode,
          percent: progress.percent,
          filesDone: progress.filesDone,
          filesTotal: progress.filesTotal,
          filesCancelled: progress.filesCancelled,
          files: progress.files,
          currentPath: progress.currentPath,
          finished,
        }
        const index = prev.findIndex(
          (item) => item.transferId === progress.transferId,
        )
        if (index === -1) {
          setExpanded(true)
          return [next, ...prev].slice(0, 12)
        }
        const copy = prev.slice()
        copy[index] = next
        return copy
      })
    }

    const offDown = window.sshApi.onFsDownloadProgress((progress) =>
      apply('download', progress),
    )
    const offUp = window.sshApi.onFsUploadProgress((progress) =>
      apply('upload', progress),
    )

    const onQueue = (event: Event) => {
      const detail = (event as CustomEvent<{ queued?: number }>).detail
      setQueuedUploads(Math.max(0, detail?.queued ?? 0))
    }
    window.addEventListener('customssh:transfer-queue', onQueue)

    return () => {
      offDown()
      offUp()
      window.removeEventListener('customssh:transfer-queue', onQueue)
    }
  }, [])

  useEffect(() => {
    const allFinished =
      batches.length > 0 && batches.every((batch) => batch.finished)
    if (!allFinished || queuedUploads > 0) return
    const timer = window.setTimeout(() => {
      setBatches((prev) => prev.filter((batch) => !batch.finished))
      setExpanded(false)
    }, 12_000)
    return () => window.clearTimeout(timer)
  }, [batches, queuedUploads])

  const activeBatches = useMemo(
    () => batches.filter((batch) => !batch.finished),
    [batches],
  )
  const visible = batches.length > 0 || queuedUploads > 0

  const summaryPercent = useMemo(() => {
    if (activeBatches.length === 0) return 100
    const total = activeBatches.reduce(
      (sum, batch) => sum + Math.max(batch.filesTotal, 1),
      0,
    )
    const done = activeBatches.reduce(
      (sum, batch) =>
        sum + batch.filesDone + batch.filesCancelled + batch.percent / 100,
      0,
    )
    // Prefer live percent of the newest active batch.
    return Math.round(activeBatches[0]?.percent ?? (done / total) * 100)
  }, [activeBatches])

  const activeFiles = activeBatches.reduce(
    (sum, batch) =>
      sum +
      batch.files.filter(
        (file) => file.status === 'active' || file.status === 'pending',
      ).length,
    0,
  )

  const summaryLabel = (() => {
    if (activeBatches.length === 0 && queuedUploads > 0) {
      return formatMessage(t('fileUploadQueued'), { count: queuedUploads })
    }
    if (activeBatches.length === 0) {
      return t('transferDockIdle')
    }
    const uploading = activeBatches.some((batch) => batch.mode === 'upload')
    const downloading = activeBatches.some((batch) => batch.mode === 'download')
    if (uploading && downloading) {
      return formatMessage(t('transferDockMixed'), {
        count: Math.max(activeFiles, activeBatches.length),
        percent: summaryPercent,
      })
    }
    if (uploading) {
      return formatMessage(t('transferDockUploading'), {
        count: Math.max(activeFiles, 1),
        percent: summaryPercent,
      })
    }
    return formatMessage(t('transferDockDownloading'), {
      count: Math.max(activeFiles, 1),
      percent: summaryPercent,
    })
  })()

  const cancelFile = (transferId: string, fileKey: string) => {
    void window.sshApi.cancelTransferFile(transferId, fileKey)
    setBatches((prev) =>
      prev.map((batch) => {
        if (batch.transferId !== transferId) return batch
        return {
          ...batch,
          files: batch.files.map((file) =>
            file.key === fileKey &&
            (file.status === 'pending' || file.status === 'active')
              ? { ...file, status: 'cancelled' }
              : file,
          ),
        }
      }),
    )
  }

  const clearFinished = () => {
    setBatches((prev) => prev.filter((batch) => !batch.finished))
    if (queuedUploads === 0) setExpanded(false)
  }

  if (!visible) return null

  return (
    <div
      className={`transfer-dock${expanded ? ' is-expanded' : ''}`}
      aria-live="polite"
    >
      <button
        type="button"
        className="transfer-dock__bar"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
      >
        <span className="transfer-dock__bar-icon" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
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
        </span>
        <span className="transfer-dock__bar-title">{t('transferDockTitle')}</span>
        <span className="transfer-dock__bar-summary">{summaryLabel}</span>
        {activeBatches.length > 0 ? (
          <span className="transfer-dock__bar-progress">
            <ProgressBar value={summaryPercent} />
          </span>
        ) : null}
        <span className="transfer-dock__bar-chevron" aria-hidden>
          <ChevronIcon open={expanded} />
        </span>
      </button>

      {expanded ? (
        <div className="transfer-dock__panel">
          <div className="transfer-dock__panel-head">
            <div className="transfer-dock__panel-title">
              {t('transferDockTitle')}
            </div>
            <button
              type="button"
              className="transfer-dock__clear"
              onClick={clearFinished}
              disabled={!batches.some((batch) => batch.finished)}
            >
              {t('transferDockClear')}
            </button>
          </div>

          {queuedUploads > 0 ? (
            <div className="transfer-dock__queue">
              {formatMessage(t('fileUploadQueued'), { count: queuedUploads })}
            </div>
          ) : null}

          <div className="transfer-dock__list">
            {batches.map((batch) => (
              <div
                key={batch.transferId}
                className={`transfer-dock__batch${
                  batch.finished ? ' is-finished' : ''
                }`}
              >
                <div className="transfer-dock__batch-head">
                  <div className="transfer-dock__batch-label">
                    {batch.mode === 'upload'
                      ? t('transferDockBatchUpload')
                      : t('transferDockBatchDownload')}
                    <span>
                      {batch.filesDone}/{batch.filesTotal}
                      {batch.filesCancelled > 0
                        ? ` · ${formatMessage(t('transferDockCancelledCount'), {
                            count: batch.filesCancelled,
                          })}`
                        : ''}
                    </span>
                  </div>
                  {!batch.finished ? (
                    <div className="transfer-dock__batch-meter">
                      <ProgressBar value={batch.percent} />
                    </div>
                  ) : null}
                </div>

                <div className="transfer-dock__files">
                  {batch.files.map((file) => {
                    const canCancel =
                      !batch.finished &&
                      (file.status === 'pending' || file.status === 'active')
                    const statusLabel =
                      file.status === 'done'
                        ? t('fileTransferDone')
                        : file.status === 'cancelled'
                          ? t('fileTransferCancelled')
                          : file.status === 'active'
                            ? t('fileTransferActive')
                            : t('fileTransferPending')
                    return (
                      <div
                        key={file.key}
                        className={`transfer-dock__file is-${file.status}`}
                      >
                        <div
                          className="transfer-dock__file-main"
                          title={file.path}
                        >
                          <span className="transfer-dock__file-status">
                            {statusLabel}
                          </span>
                          <span className="transfer-dock__file-name">
                            {basename(file.path)}
                          </span>
                          <span className="transfer-dock__file-path">
                            {file.path}
                          </span>
                        </div>
                        {canCancel ? (
                          <button
                            type="button"
                            className="transfer-dock__cancel"
                            onClick={() =>
                              cancelFile(batch.transferId, file.key)
                            }
                          >
                            {t('fileTransferCancel')}
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
