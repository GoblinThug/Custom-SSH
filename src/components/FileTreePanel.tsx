import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useSettings } from '../i18n/SettingsContext'
import type { RemoteFsEntry } from '../types'
import { formatBytes, isImageFile, measureImage } from '../imageFiles'
import { isArchiveFile } from '../archiveFiles'
import { isAudioFile } from '../audioFiles'
import { isVideoFile } from '../videoFiles'
import { formatAppError } from '../utils/formatAppError'
import { ChevronIcon } from './ChevronIcon'

function emitTransferQueue(queued: number) {
  window.dispatchEvent(
    new CustomEvent('customssh:transfer-queue', {
      detail: { queued },
    }),
  )
}

type Props = {
  open: boolean
  pinned: boolean
  sessionId: string | null
  onClose: () => void
  onPinnedChange: (pinned: boolean) => void
  onNavigate?: (remotePath: string) => void
}

function parentChain(cwd: string): string[] {
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

function parentDir(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean)
  if (parts.length <= 1) return '/'
  return `/${parts.slice(0, -1).join('/')}`
}

function joinRemote(dir: string, name: string): string {
  if (dir === '/') return `/${name}`
  return `${dir.replace(/\/+$/, '')}/${name}`
}

function isRemoteDescendant(path: string, ancestor: string): boolean {
  if (ancestor === '/') return path !== '/'
  return path === ancestor || path.startsWith(`${ancestor}/`)
}

function canMovePathsTo(sources: string[], targetDir: string): boolean {
  return sources.some((src) => {
    if (!src || src === '/') return false
    if (src === targetDir) return false
    if (isRemoteDescendant(targetDir, src)) return false
    return parentDir(src) !== targetDir
  })
}

const INTERNAL_MOVE_MIME = 'application/x-customssh-paths'
const IMAGE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024
const IMAGE_HOVER_DELAY_MS = 180

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

function displayName(path: string): string {
  if (path === '/') return 'root'
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || 'root'
}

function normalizeRemotePath(input: string): string {
  const value = input.trim().replace(/\\/g, '/')
  if (!value || value === '/') return '/'
  const withSlash = value.startsWith('/') ? value : `/${value}`
  const parts = withSlash.split('/').filter(Boolean)
  return parts.length === 0 ? '/' : `/${parts.join('/')}`
}

function scrollFolderToTop(
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

function formatMessage(
  template: string,
  values: Record<string, string | number>,
) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  )
}

function FolderIcon() {
  return (
    <svg
      className="file-tree__folder-icon"
      width="14"
      height="14"
      viewBox="0 0 256 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M224,64H154.667l-27.7334-20.7998A16.10323,16.10323,0,0,0,117.333,40H72A16.01833,16.01833,0,0,0,56,56V72H40A16.01833,16.01833,0,0,0,24,88V200a16.01833,16.01833,0,0,0,16,16H192.88867A15.12831,15.12831,0,0,0,208,200.88867V184h16.88867A15.12831,15.12831,0,0,0,240,168.88867V80A16.01833,16.01833,0,0,0,224,64Zm0,104H208V112a16.01833,16.01833,0,0,0-16-16H122.667L94.93359,75.2002A16.10323,16.10323,0,0,0,85.333,72H72V56h45.333l27.7334,20.7998A16.10323,16.10323,0,0,0,154.667,80H224Z"
        fill="currentColor"
      />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg
      className="file-tree__file-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M14 2v6h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ArchiveFileIcon() {
  return (
    <svg
      className="file-tree__file-icon file-tree__file-icon--archive"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3.95526 2.25C3.97013 2.25001 3.98505 2.25001 4.00001 2.25001L20.0448 2.25C20.4776 2.24995 20.8744 2.24991 21.1972 2.29331C21.5527 2.3411 21.9284 2.45355 22.2374 2.76257C22.5465 3.07159 22.6589 3.44732 22.7067 3.8028C22.7501 4.12561 22.7501 4.52245 22.75 4.95526V5.04475C22.7501 5.47757 22.7501 5.8744 22.7067 6.19721C22.6589 6.55269 22.5465 6.92842 22.2374 7.23744C21.9437 7.53121 21.5896 7.64733 21.25 7.69914V13.0564C21.25 14.8942 21.25 16.3498 21.0969 17.489C20.9392 18.6615 20.6071 19.6104 19.8588 20.3588C19.1104 21.1071 18.1615 21.4392 16.989 21.5969C15.8498 21.75 14.3942 21.75 12.5564 21.75H11.4436C9.60583 21.75 8.1502 21.75 7.01098 21.5969C5.83856 21.4392 4.88961 21.1071 4.14125 20.3588C3.39289 19.6104 3.06077 18.6615 2.90314 17.489C2.74998 16.3498 2.74999 14.8942 2.75001 13.0564L2.75001 7.69914C2.41038 7.64733 2.05634 7.53121 1.76257 7.23744C1.45355 6.92842 1.3411 6.55269 1.29331 6.19721C1.24991 5.8744 1.24995 5.47757 1.25 5.04476C1.25001 5.02988 1.25001 5.01496 1.25001 5.00001C1.25001 4.98505 1.25001 4.97013 1.25 4.95526C1.24995 4.52244 1.24991 4.12561 1.29331 3.8028C1.3411 3.44732 1.45355 3.07159 1.76257 2.76257C2.07159 2.45355 2.44732 2.3411 2.8028 2.29331C3.12561 2.24991 3.52244 2.24995 3.95526 2.25ZM4.25001 7.75001V13C4.25001 14.9068 4.2516 16.2615 4.38977 17.2892C4.52503 18.2952 4.7787 18.8749 5.20191 19.2981C5.62512 19.7213 6.20477 19.975 7.21086 20.1102C8.23852 20.2484 9.59319 20.25 11.5 20.25H12.5C14.4068 20.25 15.7615 20.2484 16.7892 20.1102C17.7952 19.975 18.3749 19.7213 18.7981 19.2981C19.2213 18.8749 19.475 18.2952 19.6102 17.2892C19.7484 16.2615 19.75 14.9068 19.75 13V7.75001H4.25001ZM2.82324 3.82324L2.82568 3.82187C2.82761 3.82086 2.83093 3.81924 2.83597 3.81717C2.85775 3.80821 2.90611 3.79291 3.00267 3.77993C3.21339 3.7516 3.5074 3.75001 4.00001 3.75001H20C20.4926 3.75001 20.7866 3.7516 20.9973 3.77993C21.0939 3.79291 21.1423 3.80821 21.164 3.81717C21.1691 3.81924 21.1724 3.82086 21.1743 3.82187L21.1768 3.82323L21.1781 3.82568C21.1792 3.82761 21.1808 3.83093 21.1828 3.83597C21.1918 3.85775 21.2071 3.90611 21.2201 4.00267C21.2484 4.21339 21.25 4.5074 21.25 5.00001C21.25 5.49261 21.2484 5.78662 21.2201 5.99734C21.2071 6.0939 21.1918 6.14226 21.1828 6.16404C21.1808 6.16909 21.1792 6.1724 21.1781 6.17434L21.1768 6.17678L21.1743 6.17815C21.1724 6.17916 21.1691 6.18077 21.164 6.18285C21.1423 6.19181 21.0939 6.2071 20.9973 6.22008C20.7866 6.24841 20.4926 6.25001 20 6.25001H4.00001C3.5074 6.25001 3.21339 6.24841 3.00267 6.22008C2.90611 6.2071 2.85775 6.19181 2.83597 6.18285C2.83093 6.18077 2.82761 6.17916 2.82568 6.17815L2.82324 6.17677L2.82187 6.17434C2.82086 6.1724 2.81924 6.16909 2.81717 6.16404C2.80821 6.14226 2.79291 6.0939 2.77993 5.99734C2.7516 5.78662 2.75001 5.49261 2.75001 5.00001C2.75001 4.5074 2.7516 4.21339 2.77993 4.00267C2.79291 3.90611 2.80821 3.85775 2.81717 3.83597C2.81924 3.83093 2.82086 3.82761 2.82187 3.82568L2.82324 3.82324ZM10.4782 9.75001H13.5218C13.736 9.74999 13.9329 9.74998 14.0982 9.76126C14.2759 9.77338 14.4712 9.80099 14.6697 9.88322C15.0985 10.0608 15.4392 10.4015 15.6168 10.8303C15.699 11.0288 15.7266 11.2242 15.7388 11.4018C15.75 11.5671 15.75 11.764 15.75 11.9782V12.0218C15.75 12.236 15.75 12.4329 15.7388 12.5982C15.7266 12.7759 15.699 12.9712 15.6168 13.1697C15.4392 13.5985 15.0985 13.9392 14.6697 14.1168C14.4712 14.199 14.2759 14.2266 14.0982 14.2388C13.9329 14.25 13.736 14.25 13.5218 14.25H10.4782C10.264 14.25 10.0671 14.25 9.9018 14.2388C9.72416 14.2266 9.52881 14.199 9.33031 14.1168C8.90151 13.9392 8.56083 13.5985 8.38322 13.1697C8.30099 12.9712 8.27338 12.7759 8.26126 12.5982C8.24998 12.4329 8.24999 12.236 8.25001 12.0218V11.9782C8.24999 11.764 8.24998 11.5671 8.26126 11.4018C8.27338 11.2242 8.30099 11.0288 8.38322 10.8303C8.56083 10.4015 8.90151 10.0608 9.33031 9.88322C9.52881 9.80099 9.72416 9.77338 9.9018 9.76126C10.0671 9.74998 10.264 9.74999 10.4782 9.75001ZM9.90131 11.2703C9.84248 11.2956 9.79559 11.3425 9.77031 11.4013C9.76844 11.4087 9.76234 11.4371 9.75778 11.5039C9.75041 11.6119 9.75001 11.7568 9.75001 12C9.75001 12.2432 9.75041 12.3881 9.75778 12.4961C9.76234 12.5629 9.76844 12.5913 9.77031 12.5987C9.79559 12.6575 9.84248 12.7044 9.90131 12.7297C9.90867 12.7316 9.93707 12.7377 10.0039 12.7422C10.1119 12.7496 10.2568 12.75 10.5 12.75H13.5C13.7432 12.75 13.8881 12.7496 13.9961 12.7422C14.0629 12.7377 14.0913 12.7316 14.0987 12.7297C14.1575 12.7044 14.2044 12.6575 14.2297 12.5987C14.2316 12.5913 14.2377 12.5629 14.2422 12.4961C14.2496 12.3881 14.25 12.2432 14.25 12C14.25 11.7568 14.2496 11.6119 14.2422 11.5039C14.2377 11.4371 14.2316 11.4087 14.2297 11.4013C14.2044 11.3425 14.1575 11.2956 14.0987 11.2703C14.0913 11.2684 14.0629 11.2623 13.9961 11.2578C13.8881 11.2504 13.7432 11.25 13.5 11.25H10.5C10.2568 11.25 10.1119 11.2504 10.0039 11.2578C9.93707 11.2623 9.90866 11.2684 9.90131 11.2703Z"
        fill="currentColor"
      />
    </svg>
  )
}

function VideoFileIcon() {
  return (
    <svg
      className="file-tree__file-icon file-tree__file-icon--video"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.45109 3.25H9.54891C11.1512 3.24999 12.4205 3.24998 13.4248 3.36868C14.4557 3.49054 15.3044 3.74638 16.0134 4.3282C16.2539 4.52558 16.4744 4.74612 16.6718 4.98663C17.2536 5.69558 17.5095 6.54428 17.6313 7.57525C17.6587 7.80698 17.6798 8.05283 17.696 8.31364C18.482 7.92192 19.148 7.60005 19.7032 7.41841C20.3546 7.20525 21.0456 7.11922 21.6829 7.51309C22.3202 7.90695 22.5523 8.56347 22.6529 9.24146C22.7501 9.89558 22.75 10.7572 22.75 11.7924V12.2076C22.75 13.2428 22.7501 14.1044 22.6529 14.7585C22.5523 15.4365 22.3202 16.093 21.6829 16.4869C21.0456 16.8808 20.3546 16.7948 19.7032 16.5816C19.148 16.3999 18.482 16.0781 17.696 15.6864C17.6798 15.9472 17.6587 16.193 17.6313 16.4248C17.5095 17.4557 17.2536 18.3044 16.6718 19.0134C16.4744 19.2539 16.2539 19.4744 16.0134 19.6718C15.3044 20.2536 14.4557 20.5095 13.4248 20.6313C12.4205 20.75 11.1512 20.75 9.54895 20.75H9.45105C7.84881 20.75 6.57946 20.75 5.57525 20.6313C4.54428 20.5095 3.69558 20.2536 2.98663 19.6718C2.74612 19.4744 2.52558 19.2539 2.3282 19.0134C1.74638 18.3044 1.49054 17.4557 1.36868 16.4248C1.24998 15.4205 1.24999 14.1512 1.25 12.5489V11.4511C1.24999 9.84882 1.24998 8.57947 1.36868 7.57525C1.49054 6.54428 1.74638 5.69558 2.3282 4.98663C2.52558 4.74612 2.74612 4.52558 2.98663 4.3282C3.69558 3.74638 4.54428 3.49054 5.57525 3.36868C6.57947 3.24998 7.84883 3.24999 9.45109 3.25ZM16.25 12.5V11.5C16.25 9.83789 16.2488 8.65724 16.1417 7.75133C16.0366 6.86197 15.8384 6.33563 15.5123 5.93822C15.3772 5.77366 15.2263 5.62277 15.0618 5.48772C14.6644 5.16158 14.138 4.96344 13.2487 4.85831C12.3428 4.75123 11.1621 4.75 9.5 4.75C7.83789 4.75 6.65724 4.75123 5.75133 4.85831C4.86197 4.96344 4.33563 5.16158 3.93822 5.48772C3.77366 5.62277 3.62277 5.77366 3.48772 5.93822C3.16158 6.33563 2.96344 6.86197 2.85831 7.75133C2.75123 8.65724 2.75 9.83789 2.75 11.5V12.5C2.75 14.1621 2.75123 15.3428 2.85831 16.2487C2.96344 17.138 3.16158 17.6644 3.48772 18.0618C3.62277 18.2263 3.77366 18.3772 3.93822 18.5123C4.33563 18.8384 4.86197 19.0366 5.75133 19.1417C6.65724 19.2488 7.83789 19.25 9.5 19.25C11.1621 19.25 12.3428 19.2488 13.2487 19.1417C14.138 19.0366 14.6644 18.8384 15.0618 18.5123C15.2263 18.3772 15.3772 18.2263 15.5123 18.0618C15.8384 17.6644 16.0366 17.138 16.1417 16.2487C16.2488 15.3428 16.25 14.1621 16.25 12.5ZM17.75 14.0365L17.9938 14.1584C18.9892 14.6561 19.6598 14.9891 20.1697 15.156C20.669 15.3194 20.8202 15.2567 20.8943 15.2109C20.9684 15.1651 21.092 15.0579 21.1692 14.5382C21.248 14.0076 21.25 13.2588 21.25 12.1459V11.8541C21.25 10.7412 21.248 9.99243 21.1692 9.46179C21.092 8.94208 20.9684 8.83487 20.8943 8.78906C20.8202 8.74326 20.669 8.68063 20.1697 8.84403C19.6598 9.01086 18.9892 9.34395 17.9938 9.84164L17.75 9.96353V11.3665C17.75 11.3946 17.75 11.4228 17.75 11.4511V12.5489C17.75 12.5772 17.75 12.6054 17.75 12.6335V14.0365Z"
        fill="currentColor"
      />
    </svg>
  )
}

function AudioFileIcon() {
  return (
    <svg
      className="file-tree__file-icon file-tree__file-icon--audio"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M18.6731 3.66678C18.0356 3.78024 17.1965 4.05792 15.9723 4.466L11.9723 5.79934C11.2959 6.02481 10.8487 6.17507 10.5192 6.32833C10.2072 6.47345 10.0724 6.59025 9.98595 6.71015C9.89953 6.83005 9.83138 6.99494 9.79235 7.33679C9.75113 7.69779 9.75 8.16956 9.75 8.88256V10.959L20.25 7.45895C20.2499 6.21736 20.2459 5.35983 20.1541 4.7342C20.0627 4.11097 19.906 3.88657 19.7309 3.76032C19.5557 3.63407 19.2933 3.55641 18.6731 3.66678ZM21.7402 5.99952C21.7279 5.43502 21.7003 4.93995 21.6382 4.51655C21.522 3.72389 21.2634 3.01586 20.608 2.54346C19.9525 2.07106 19.1991 2.04961 18.4103 2.18999C17.6516 2.32502 16.7078 2.63965 15.5559 3.02365L11.4584 4.38947C10.8321 4.59824 10.3027 4.77466 9.88651 4.96829C9.44407 5.17412 9.06018 5.42921 8.76908 5.83309C8.47799 6.23696 8.35738 6.68182 8.30203 7.16664C8.27376 7.41423 8.26085 7.69183 8.25495 7.99952H8.25V8.7587C8.25 8.78594 8.25 8.81336 8.25 8.84095L8.25 15.9992C7.62325 15.5285 6.8442 15.2495 6 15.2495C3.92893 15.2495 2.25 16.9285 2.25 18.9995C2.25 21.0706 3.92893 22.7495 6 22.7495C8.07107 22.7495 9.75 21.0706 9.75 18.9995V12.5401L20.25 9.04009V13.9992C19.6233 13.5285 18.8442 13.2495 18 13.2495C15.9289 13.2495 14.25 14.9285 14.25 16.9995C14.25 19.0706 15.9289 20.7495 18 20.7495C20.0711 20.7495 21.75 19.0706 21.75 16.9995V7.4881C21.75 7.45241 21.75 7.41692 21.75 7.38161V5.99952H21.7402ZM20.25 16.9995C20.25 15.7569 19.2426 14.7495 18 14.7495C16.7574 14.7495 15.75 15.7569 15.75 16.9995C15.75 18.2422 16.7574 19.2495 18 19.2495C19.2426 19.2495 20.25 18.2422 20.25 16.9995ZM8.25 18.9995C8.25 17.7569 7.24264 16.7495 6 16.7495C4.75736 16.7495 3.75 17.7569 3.75 18.9995C3.75 20.2422 4.75736 21.2495 6 21.2495C7.24264 21.2495 8.25 20.2422 8.25 18.9995Z"
        fill="currentColor"
      />
    </svg>
  )
}

function ImageFileIcon() {
  return (
    <svg
      className="file-tree__file-icon file-tree__file-icon--image"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16 6.75C15.3096 6.75 14.75 7.30964 14.75 8C14.75 8.69036 15.3096 9.25 16 9.25C16.6904 9.25 17.25 8.69036 17.25 8C17.25 7.30964 16.6904 6.75 16 6.75ZM13.25 8C13.25 6.48122 14.4812 5.25 16 5.25C17.5188 5.25 18.75 6.48122 18.75 8C18.75 9.51878 17.5188 10.75 16 10.75C14.4812 10.75 13.25 9.51878 13.25 8Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.9426 1.25H12.0574C14.3658 1.24999 16.1748 1.24998 17.5863 1.43975C19.031 1.63399 20.1711 2.03933 21.0659 2.93414C21.9607 3.82895 22.366 4.96897 22.5603 6.41371C22.75 7.82519 22.75 9.63423 22.75 11.9426V12.0574C22.75 14.3658 22.75 16.1748 22.5603 17.5863C22.366 19.031 21.9607 20.1711 21.0659 21.0659C20.1711 21.9607 19.031 22.366 17.5863 22.5603C16.1748 22.75 14.3658 22.75 12.0574 22.75H11.9426C9.63423 22.75 7.82519 22.75 6.41371 22.5603C4.96897 22.366 3.82895 21.9607 2.93414 21.0659C2.03933 20.1711 1.63399 19.031 1.43975 17.5863C1.24998 16.1748 1.24999 14.3658 1.25 12.0574V11.9426C1.24999 9.63423 1.24998 7.82519 1.43975 6.41371C1.63399 4.96897 2.03933 3.82895 2.93414 2.93414C3.82895 2.03933 4.96897 1.63399 6.41371 1.43975C7.82519 1.24998 9.63423 1.24999 11.9426 1.25ZM3.9948 20.0052C3.42514 19.4355 3.09825 18.6648 2.92637 17.3864C2.77289 16.2449 2.75296 14.7885 2.75038 12.8401L4.24546 11.5319C4.85958 10.9946 5.78515 11.0254 6.36216 11.6024L10.6519 15.8922C11.5968 16.8371 13.0843 16.9659 14.1776 16.1975L14.4758 15.988C15.334 15.3849 16.4951 15.4547 17.2747 16.1564L20.4983 19.0576C20.5334 19.0892 20.5706 19.1168 20.6095 19.1406C20.4478 19.4815 20.2487 19.7617 20.0052 20.0052C19.4355 20.5749 18.6648 20.9018 17.3864 21.0736C16.0864 21.2484 14.3782 21.25 12 21.25C9.62177 21.25 7.91356 21.2484 6.61358 21.0736C5.33517 20.9018 4.56445 20.5749 3.9948 20.0052ZM6.61358 2.92637C5.33517 3.09825 4.56445 3.42514 3.9948 3.9948C3.42514 4.56445 3.09825 5.33517 2.92637 6.61358C2.78124 7.69307 2.75552 9.05407 2.75098 10.8465L3.25771 10.4031C4.46613 9.34572 6.28741 9.40636 7.42282 10.5418L11.7125 14.8315C12.1421 15.261 12.8182 15.3196 13.3152 14.9703L13.6134 14.7607C15.0437 13.7555 16.9788 13.872 18.2782 15.0415L21.0522 17.5381C21.0596 17.4883 21.0667 17.4378 21.0736 17.3864C21.2484 16.0864 21.25 14.3782 21.25 12C21.25 9.62177 21.2484 7.91356 21.0736 6.61358C20.9018 5.33517 20.5749 4.56445 20.0052 3.9948C19.4355 3.42514 18.6648 3.09825 17.3864 2.92637C16.0864 2.75159 14.3782 2.75 12 2.75C9.62177 2.75 7.91356 2.75159 6.61358 2.92637Z"
        fill="currentColor"
      />
    </svg>
  )
}

function ImageHoverPreview({
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

function entryMatchesFilter(
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

function TreeNode({
  path,
  depth,
  cwd,
  sessionId,
  expanded,
  childrenMap,
  loadingPaths,
  selectedPaths,
  dropTarget,
  filterQuery,
  onToggle,
  onReveal,
  onGo,
  onEntryClick,
  onEntryContextMenu,
  onFileDoubleClick,
  onEntryDragStart,
  onEntryDragEnd,
  onTreeDragOver,
  onTreeDrop,
  onImageHoverStart,
  onImageHoverEnd,
  goLabel,
  loadingLabel,
  emptyLabel,
}: {
  path: string
  depth: number
  cwd: string
  sessionId: string | null
  expanded: Set<string>
  childrenMap: Record<string, RemoteFsEntry[]>
  loadingPaths: Set<string>
  selectedPaths: Set<string>
  dropTarget: string | null
  filterQuery: string
  onToggle: (path: string) => void
  onReveal: (remotePath: string) => void
  onGo?: (remotePath: string) => void
  onEntryClick: (entry: RemoteFsEntry, event: ReactMouseEvent) => void
  onEntryContextMenu: (entry: RemoteFsEntry, event: ReactMouseEvent) => void
  onFileDoubleClick: (entry: RemoteFsEntry) => void
  onEntryDragStart: (entry: RemoteFsEntry, event: ReactDragEvent) => void
  onEntryDragEnd: () => void
  onTreeDragOver: (remoteDir: string, event: ReactDragEvent) => void
  onTreeDrop: (remoteDir: string, event: ReactDragEvent) => void
  onImageHoverStart?: (entry: RemoteFsEntry, rect: DOMRect) => void
  onImageHoverEnd?: () => void
  goLabel: string
  loadingLabel: string
  emptyLabel: string
}) {
  const onPath = parentChain(cwd).includes(path)
  const isExactCwd = cwd === path
  const kids = childrenMap[path]
  const visibleKids = kids?.filter((entry) =>
    entryMatchesFilter(entry, filterQuery, childrenMap),
  )
  const filtering = Boolean(filterQuery.trim())
  const isExpanded =
    expanded.has(path) || (filtering && (visibleKids?.length ?? 0) > 0)
  const loading = loadingPaths.has(path)
  const folderEntry: RemoteFsEntry = {
    name: displayName(path),
    path,
    isDir: true,
  }
  const folderSelected = path !== '/' && selectedPaths.has(path)
  const isDropTarget = dropTarget === path
  const canDragFolder = path !== '/'

  return (
    <div className="file-tree__node">
      <div
        className={`file-tree__row${isExactCwd ? ' is-cwd' : ''}${onPath ? ' is-on-path' : ''}${
          folderSelected ? ' is-selected' : ''
        }${isDropTarget ? ' is-drop-target' : ''}`}
        data-tree-path={path}
        style={{ paddingLeft: 10 + depth * 14 }}
        draggable={canDragFolder}
        onDragStart={(event) => {
          if (!canDragFolder) {
            event.preventDefault()
            return
          }
          onEntryDragStart(folderEntry, event)
        }}
        onDragEnd={onEntryDragEnd}
        onDragOver={(event) => onTreeDragOver(path, event)}
        onDrop={(event) => onTreeDrop(path, event)}
        onContextMenu={(event) => {
          event.preventDefault()
          onEntryContextMenu(folderEntry, event)
        }}
      >
        <button
          type="button"
          className="file-tree__main"
          onClick={(event) => {
            if (path !== '/' && (event.ctrlKey || event.metaKey || event.shiftKey)) {
              onEntryClick(folderEntry, event)
              return
            }
            onToggle(path)
          }}
          onDoubleClick={() => onReveal(path)}
          title={path}
        >
          <span className="file-tree__chevron">
            <ChevronIcon open={isExpanded} />
          </span>
          <FolderIcon />
          <span className="file-tree__label">{displayName(path)}</span>
        </button>
        {onGo ? (
          <button
            type="button"
            className="file-tree__go"
            title={`cd ${path}`}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation()
              onGo(path)
            }}
          >
            {goLabel}
          </button>
        ) : null}
      </div>

      {isExpanded ? (
        <div className="file-tree__children">
          {loading && !kids ? (
            <div
              className="file-tree__meta"
              style={{ paddingLeft: 28 + depth * 14 }}
            >
              {loadingLabel}
            </div>
          ) : null}
          {visibleKids?.map((entry) =>
            entry.isDir ? (
              <TreeNode
                key={entry.path}
                path={entry.path}
                depth={depth + 1}
                cwd={cwd}
                sessionId={sessionId}
                expanded={expanded}
                childrenMap={childrenMap}
                loadingPaths={loadingPaths}
                selectedPaths={selectedPaths}
                dropTarget={dropTarget}
                filterQuery={filterQuery}
                onToggle={onToggle}
                onReveal={onReveal}
                onGo={onGo}
                onEntryClick={onEntryClick}
                onEntryContextMenu={onEntryContextMenu}
                onFileDoubleClick={onFileDoubleClick}
                onEntryDragStart={onEntryDragStart}
                onEntryDragEnd={onEntryDragEnd}
                onTreeDragOver={onTreeDragOver}
                onTreeDrop={onTreeDrop}
                onImageHoverStart={onImageHoverStart}
                onImageHoverEnd={onImageHoverEnd}
                goLabel={goLabel}
                loadingLabel={loadingLabel}
                emptyLabel={emptyLabel}
              />
            ) : (
              <button
                key={entry.path}
                type="button"
                className={`file-tree__row file-tree__row--file${
                  isImageFile(entry.name) ? ' file-tree__row--image' : ''
                }${
                  isArchiveFile(entry.name) || isArchiveFile(entry.path)
                    ? ' file-tree__row--archive'
                    : ''
                }${
                  isAudioFile(entry.name) || isAudioFile(entry.path)
                    ? ' file-tree__row--audio'
                    : ''
                }${
                  isVideoFile(entry.name) || isVideoFile(entry.path)
                    ? ' file-tree__row--video'
                    : ''
                }${selectedPaths.has(entry.path) ? ' is-selected' : ''}`}
                style={{ paddingLeft: 24 + (depth + 1) * 14 }}
                title={entry.path}
                draggable
                onDragStart={(event) => onEntryDragStart(entry, event)}
                onDragEnd={onEntryDragEnd}
                onClick={(event) => onEntryClick(entry, event)}
                onContextMenu={(event) => onEntryContextMenu(entry, event)}
                onDragOver={(event) => onTreeDragOver(parentDir(entry.path), event)}
                onDrop={(event) => onTreeDrop(parentDir(entry.path), event)}
                onMouseEnter={(event) => {
                  if (!isImageFile(entry.name) || !sessionId) return
                  onImageHoverStart?.(
                    entry,
                    event.currentTarget.getBoundingClientRect(),
                  )
                }}
                onMouseLeave={() => {
                  if (isImageFile(entry.name)) onImageHoverEnd?.()
                }}
                onDoubleClick={(event) => {
                  event.preventDefault()
                  onFileDoubleClick(entry)
                }}
              >
                <span className="file-tree__chevron file-tree__chevron--spacer" />
                {isImageFile(entry.name) ? (
                  <ImageFileIcon />
                ) : isArchiveFile(entry.name) || isArchiveFile(entry.path) ? (
                  <ArchiveFileIcon />
                ) : isAudioFile(entry.name) || isAudioFile(entry.path) ? (
                  <AudioFileIcon />
                ) : isVideoFile(entry.name) || isVideoFile(entry.path) ? (
                  <VideoFileIcon />
                ) : (
                  <FileIcon />
                )}
                <span className="file-tree__label">{entry.name}</span>
              </button>
            ),
          )}
          {kids && kids.length === 0 ? (
            <div
              className="file-tree__meta"
              style={{ paddingLeft: 28 + depth * 14 }}
            >
              {emptyLabel}
            </div>
          ) : null}
          {kids &&
          kids.length > 0 &&
          visibleKids &&
          visibleKids.length === 0 &&
          filterQuery.trim() ? (
            <div
              className="file-tree__meta"
              style={{ paddingLeft: 28 + depth * 14 }}
            >
              {emptyLabel}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function FileTreePanel({
  open,
  pinned,
  sessionId,
  onClose,
  onPinnedChange,
  onNavigate,
}: Props) {
  const { t } = useSettings()
  const [cwd, setCwd] = useState('/')
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['/']))
  const [childrenMap, setChildrenMap] = useState<Record<string, RemoteFsEntry[]>>(
    {},
  )
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [actionNote, setActionNote] = useState<string>()
  /** External file drag is over the app window (beacon the panel). */
  const [appFileDrag, setAppFileDrag] = useState(false)
  /** Cursor is inside the tree list — switch from panel beacon to folder target. */
  const [overTree, setOverTree] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const appDragDepthRef = useRef(0)
  const internalDragPathsRef = useRef<string[] | null>(null)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const [namePrompt, setNamePrompt] = useState<{
    mode: 'mkdir' | 'mkfile' | 'rename'
    parentPath: string
    fromPath?: string
    value: string
  } | null>(null)
  const [confirmPrompt, setConfirmPrompt] = useState<{
    title: string
    message: string
    confirmLabel: string
    danger?: boolean
    action: { type: 'delete'; paths: string[] } | { type: 'move'; moves: Array<{ from: string; to: string }>; targetDir: string }
  } | null>(null)
  const [filterQuery, setFilterQuery] = useState('')
  const [pathDraft, setPathDraft] = useState('/')
  const [pathEditing, setPathEditing] = useState(false)
  const lastSelectedRef = useRef<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const pathInputRef = useRef<HTMLInputElement>(null)
  const imageHoverTimerRef = useRef(0)
  const [imageHover, setImageHover] = useState<{
    entry: RemoteFsEntry
    rect: DOMRect
  } | null>(null)
  const scrollTargetRef = useRef<string | null>(null)
  const pathCommitRef = useRef(false)
  const uploadRunningRef = useRef(false)
  const uploadQueueRef = useRef<
    Array<{ remoteDir: string; localPaths?: string[] }>
  >([])

  const clearImageHover = useCallback(() => {
    window.clearTimeout(imageHoverTimerRef.current)
    setImageHover(null)
  }, [])

  const handleImageHoverStart = useCallback(
    (entry: RemoteFsEntry, rect: DOMRect) => {
      window.clearTimeout(imageHoverTimerRef.current)
      imageHoverTimerRef.current = window.setTimeout(() => {
        setImageHover({ entry, rect })
      }, IMAGE_HOVER_DELAY_MS)
    },
    [],
  )

  useEffect(() => {
    if (!open || !sessionId) clearImageHover()
  }, [clearImageHover, open, sessionId])

  useEffect(() => {
    if (!open || !sessionId) {
      appDragDepthRef.current = 0
      setAppFileDrag(false)
      setOverTree(false)
      setDropTarget(null)
      return
    }

    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const clearAppDrag = () => {
      appDragDepthRef.current = 0
      setAppFileDrag(false)
      setOverTree(false)
      setDropTarget(null)
    }

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      appDragDepthRef.current += 1
      setAppFileDrag(true)
    }

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      // Keep the OS "copy" cursor while files are over the window.
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setAppFileDrag(true)
    }

    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      appDragDepthRef.current = Math.max(0, appDragDepthRef.current - 1)
      if (appDragDepthRef.current === 0) {
        setAppFileDrag(false)
        setOverTree(false)
        setDropTarget(null)
      }
    }

    const onDrop = () => {
      clearAppDrag()
    }

    const onDragEnd = () => {
      clearAppDrag()
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onDragEnd)
      clearAppDrag()
    }
  }, [open, sessionId])

  useEffect(() => {
    setFilterQuery('')
    setLoadingPaths(new Set())
  }, [sessionId])

  const loadDir = useCallback(
    async (remotePath: string) => {
      const loadFor = sessionId
      if (!loadFor) return
      setLoadingPaths((prev) => new Set(prev).add(remotePath))
      try {
        const entries = await window.sshApi.fsList(loadFor, remotePath)
        if (sessionIdRef.current !== loadFor) return
        setChildrenMap((prev) => ({ ...prev, [remotePath]: entries }))
      } catch (err) {
        if (sessionIdRef.current !== loadFor) return
        setError(formatAppError(err, t, 'errFileOpFailed'))
      } finally {
        if (sessionIdRef.current !== loadFor) return
        setLoadingPaths((prev) => {
          const next = new Set(prev)
          next.delete(remotePath)
          return next
        })
      }
    },
    [sessionId, t],
  )

  const refresh = useCallback(async () => {
    const loadFor = sessionId
    if (!loadFor) return
    setBusy(true)
    setError(undefined)
    try {
      const remoteCwd = await window.sshApi.fsCwd(loadFor)
      if (sessionIdRef.current !== loadFor) return
      setCwd(remoteCwd)
      const chain = parentChain(remoteCwd)
      setExpanded(new Set(chain))
      setChildrenMap({})
      setSelectedPaths(new Set())
      lastSelectedRef.current = null
      await Promise.all(chain.map((path) => loadDir(path)))
    } catch (err) {
      if (sessionIdRef.current !== loadFor) return
      setError(formatAppError(err, t, 'errFileOpFailed'))
    } finally {
      if (sessionIdRef.current === loadFor) {
        setBusy(false)
      }
    }
  }, [sessionId, loadDir, t])

  useEffect(() => {
    if (open && sessionId) {
      void refresh()
    }
    if (!open) {
      setSelectedPaths(new Set())
      lastSelectedRef.current = null
      setConfirmPrompt(null)
      setNamePrompt(null)
    }
  }, [open, sessionId, refresh])

  useEffect(() => {
    if (typeof window.sshApi.onFsRemoteChanged !== 'function') return
    return window.sshApi.onFsRemoteChanged((payload) => {
      if (!sessionId || payload.sessionId !== sessionId) return
      void loadDir(payload.remoteDir)
    })
  }, [sessionId, loadDir])

  const onToggle = async (path: string) => {
    const willExpand = !expanded.has(path)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    if (willExpand && !childrenMap[path]) {
      await loadDir(path)
    }
  }

  const cwdLabel = useMemo(() => cwd || '/', [cwd])
  const selectedList = useMemo(() => Array.from(selectedPaths), [selectedPaths])

  useEffect(() => {
    if (pathEditing || pathCommitRef.current) return
    setPathDraft(cwdLabel)
  }, [cwdLabel, pathEditing])

  useEffect(() => {
    if (!pathEditing) return
    const input = pathInputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [pathEditing])

  const beginPathEdit = () => {
    if (!sessionId) return
    setPathDraft(cwdLabel)
    setPathEditing(true)
  }

  const cancelPathEdit = () => {
    pathCommitRef.current = false
    setPathDraft(cwdLabel)
    setPathEditing(false)
  }

  const scheduleScrollToPath = useCallback((remotePath: string) => {
    scrollTargetRef.current = remotePath
    const run = () => {
      if (scrollTargetRef.current !== remotePath) return
      scrollFolderToTop(bodyRef.current, remotePath)
      scrollTargetRef.current = null
    }
    // Wait for tree rows to mount after expand/load.
    requestAnimationFrame(() => {
      requestAnimationFrame(run)
    })
    window.setTimeout(run, 80)
  }, [])

  const revealPath = useCallback(
    async (remotePath: string) => {
      const path = normalizeRemotePath(remotePath)
      setFilterQuery('')
      setCwd(path)
      setPathDraft(path)
      setError(undefined)
      const chain = parentChain(path)
      setExpanded(new Set(chain))
      setBusy(true)
      try {
        await Promise.all(chain.map((item) => loadDir(item)))
      } finally {
        setBusy(false)
      }
      scheduleScrollToPath(path)
      return path
    },
    [loadDir, scheduleScrollToPath],
  )

  const handleReveal = (remotePath: string) => {
    void revealPath(normalizeRemotePath(remotePath))
  }

  const handleGo = (remotePath: string) => {
    const path = normalizeRemotePath(remotePath)
    onNavigate?.(path)
    void revealPath(path)
  }

  const commitPathDraft = () => {
    const path = normalizeRemotePath(pathDraft)
    pathCommitRef.current = true
    setPathDraft(path)
    setPathEditing(false)
    if (path === normalizeRemotePath(cwd)) {
      scheduleScrollToPath(path)
      pathCommitRef.current = false
      return
    }
    // Breadcrumb edit only moves the tree highlight — terminal cwd stays put.
    void revealPath(path)
      .catch(() => undefined)
      .finally(() => {
        pathCommitRef.current = false
      })
  }

  const openEditor = async (remotePath: string) => {
    if (!sessionId) return
    setActionNote(undefined)
    try {
      await window.sshApi.openEditorWindow(sessionId, remotePath)
    } catch (err) {
      setError(formatAppError(err, t, 'editorLoadFailed'))
    }
  }

  const openViewer = async (remotePath: string) => {
    if (!sessionId) return
    setActionNote(undefined)
    try {
      await window.sshApi.openViewerWindow(sessionId, remotePath)
    } catch (err) {
      setError(formatAppError(err, t, 'viewerLoadFailed'))
    }
  }

  const openArchive = async (remotePath: string) => {
    if (!sessionId) return
    setActionNote(undefined)
    if (typeof window.sshApi.openArchiveWindow !== 'function') {
      setError(t('archiveLoadFailed'))
      return
    }
    try {
      await window.sshApi.openArchiveWindow(sessionId, remotePath)
    } catch (err) {
      setError(formatAppError(err, t, 'archiveLoadFailed'))
    }
  }

  const openFile = (entry: RemoteFsEntry) => {
    if (isImageFile(entry.name) || isImageFile(entry.path)) {
      void openViewer(entry.path)
      return
    }
    if (isArchiveFile(entry.name) || isArchiveFile(entry.path)) {
      void openArchive(entry.path)
      return
    }
    void openEditor(entry.path)
  }

  const refreshDir = async (remotePath: string) => {
    await loadDir(remotePath)
    setExpanded((prev) => new Set(prev).add(remotePath))
  }

  const noteTransferResult = (
    mode: 'download' | 'upload',
    saved: number,
    cancelled: number,
    target?: string,
  ) => {
    if (saved <= 0 && cancelled > 0) {
      setActionNote(t('fileTransferCancelledOk'))
      return
    }
    if (saved > 0 && cancelled > 0) {
      setActionNote(
        formatMessage(t('fileTransferPartialOk'), {
          done: saved,
          cancelled,
        }),
      )
      return
    }
    if (saved <= 0) return
    if (mode === 'upload') {
      setActionNote(
        `${
          saved > 1
            ? formatMessage(t('fileUploadManyOk'), { count: saved })
            : t('fileUploadOk')
        }${target ? ` → ${target}` : ''}`,
      )
      return
    }
    setActionNote(
      saved > 1
        ? formatMessage(t('fileDownloadManyOk'), { count: saved })
        : t('fileDownloadOk'),
    )
  }

  const downloadItems = async (remotePaths: string[]) => {
    if (!sessionId || remotePaths.length === 0) return
    setActionNote(undefined)
    try {
      if (remotePaths.length === 1) {
        const result = await window.sshApi.fsDownload(sessionId, remotePaths[0])
        if (result.ok) {
          noteTransferResult('download', result.count, result.cancelled)
        }
        return
      }
      const result = await window.sshApi.fsDownloadMany(sessionId, remotePaths)
      if (result.ok) {
        noteTransferResult('download', result.count, result.cancelled)
      }
    } catch (err) {
      setError(formatAppError(err, t, 'fileDownloadFailed'))
    }
  }

  const runUploadJob = async (
    remoteDir: string,
    localPaths?: string[],
  ) => {
    if (!sessionId) return
    setError(undefined)
    try {
      const result = localPaths?.length
        ? await window.sshApi.fsUploadPaths(sessionId, localPaths, remoteDir)
        : await window.sshApi.fsUpload(sessionId, remoteDir)
      if (result.ok) {
        noteTransferResult(
          'upload',
          result.count,
          result.cancelled,
          remoteDir,
        )
        if (result.count > 0) {
          await refreshDir(remoteDir)
        }
      }
    } catch (err) {
      setError(formatAppError(err, t, 'fileUploadFailed'))
    }
  }

  const uploadTo = async (remoteDir: string, localPaths?: string[]) => {
    if (!sessionId) return

    // While a transfer is running, queue more uploads instead of blocking drops.
    if (uploadRunningRef.current) {
      uploadQueueRef.current.push({ remoteDir, localPaths })
      emitTransferQueue(uploadQueueRef.current.length)
      setActionNote(
        formatMessage(t('fileUploadQueued'), {
          count: localPaths?.length ?? 1,
        }),
      )
      return
    }

    uploadRunningRef.current = true
    try {
      await runUploadJob(remoteDir, localPaths)
      while (uploadQueueRef.current.length > 0) {
        const next = uploadQueueRef.current.shift()
        emitTransferQueue(uploadQueueRef.current.length)
        if (!next) break
        await runUploadJob(next.remoteDir, next.localPaths)
      }
    } finally {
      uploadRunningRef.current = false
      uploadQueueRef.current = []
      emitTransferQueue(0)
    }
  }

  const deleteItems = (remotePaths: string[]) => {
    if (!sessionId || remotePaths.length === 0) return
    setConfirmPrompt({
      title: t('fileDelete'),
      message:
        remotePaths.length === 1
          ? formatMessage(t('fileDeleteConfirm'), {
              name: displayName(remotePaths[0]),
            })
          : formatMessage(t('fileDeleteConfirmMany'), {
              count: remotePaths.length,
            }),
      confirmLabel: t('fileDelete'),
      danger: true,
      action: { type: 'delete', paths: remotePaths },
    })
  }

  const runDeleteItems = async (remotePaths: string[]) => {
    if (!sessionId || remotePaths.length === 0) return
    setBusy(true)
    setError(undefined)
    try {
      for (const remotePath of remotePaths) {
        await window.sshApi.fsRemove(sessionId, remotePath)
      }
      setActionNote(t('fileDeleteOk'))
      clearSelection()
      const parents = new Set(remotePaths.map((item) => parentDir(item)))
      await Promise.all(Array.from(parents).map((dir) => refreshDir(dir)))
    } catch (err) {
      setError(formatAppError(err, t, 'fileOpFailed'))
    } finally {
      setBusy(false)
    }
  }

  const moveItems = (remotePaths: string[], targetDir: string) => {
    if (!sessionId || remotePaths.length === 0) return
    const moves = remotePaths
      .filter((src) => src && src !== '/')
      .filter((src) => parentDir(src) !== targetDir)
      .filter((src) => src !== targetDir && !isRemoteDescendant(targetDir, src))
      .map((src) => ({
        from: src,
        to: joinRemote(targetDir, displayName(src)),
      }))
      .filter((item) => item.from !== item.to)

    if (moves.length === 0) {
      setActionNote(t('fileMoveSame'))
      return
    }

    setConfirmPrompt({
      title: t('fileMove'),
      message:
        moves.length === 1
          ? formatMessage(t('fileMoveConfirm'), {
              name: displayName(moves[0].from),
              dest: targetDir,
            })
          : formatMessage(t('fileMoveConfirmMany'), {
              count: moves.length,
              dest: targetDir,
            }),
      confirmLabel: t('fileMove'),
      action: { type: 'move', moves, targetDir },
    })
  }

  const runMoveItems = async (
    moves: Array<{ from: string; to: string }>,
    targetDir: string,
  ) => {
    if (!sessionId || moves.length === 0) return
    setBusy(true)
    setError(undefined)
    try {
      for (const item of moves) {
        await window.sshApi.fsRename(sessionId, item.from, item.to)
      }
      setActionNote(
        formatMessage(t('fileMoveOk'), {
          count: moves.length,
          dest: targetDir,
        }),
      )
      clearSelection()
      const parents = new Set<string>([targetDir])
      for (const item of moves) parents.add(parentDir(item.from))
      await Promise.all(Array.from(parents).map((dir) => refreshDir(dir)))
    } catch (err) {
      setError(formatAppError(err, t, 'fileOpFailed'))
      await refreshDir(targetDir)
    } finally {
      setBusy(false)
    }
  }

  const submitConfirmPrompt = async () => {
    const prompt = confirmPrompt
    setConfirmPrompt(null)
    if (!prompt) return
    if (prompt.action.type === 'delete') {
      await runDeleteItems(prompt.action.paths)
      return
    }
    await runMoveItems(prompt.action.moves, prompt.action.targetDir)
  }

  const isExternalFileDrag = (event: ReactDragEvent | DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files')

  const readInternalMovePaths = (event: ReactDragEvent): string[] | null => {
    if (internalDragPathsRef.current?.length) {
      return internalDragPathsRef.current
    }
    try {
      const raw = event.dataTransfer.getData(INTERNAL_MOVE_MIME)
      if (!raw) return null
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return null
      return parsed.filter((item): item is string => typeof item === 'string')
    } catch {
      return null
    }
  }

  const handleEntryDragStart = (
    entry: RemoteFsEntry,
    event: ReactDragEvent,
  ) => {
    if (entry.path === '/') {
      event.preventDefault()
      return
    }
    const paths =
      selectedPaths.has(entry.path) && selectedPaths.size > 0
        ? Array.from(selectedPaths)
        : [entry.path]
    internalDragPathsRef.current = paths
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(INTERNAL_MOVE_MIME, JSON.stringify(paths))
    event.dataTransfer.setData('text/plain', paths.join('\n'))
  }

  const handleEntryDragEnd = () => {
    internalDragPathsRef.current = null
    setDropTarget(null)
    setOverTree(false)
  }

  const handleTreeDragOver = (targetDir: string, event: ReactDragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setOverTree(true)
    if (isExternalFileDrag(event)) {
      event.dataTransfer.dropEffect = 'copy'
      setDropTarget(targetDir)
      return
    }
    const sources = internalDragPathsRef.current
    if (sources && canMovePathsTo(sources, targetDir)) {
      event.dataTransfer.dropEffect = 'move'
      setDropTarget(targetDir)
      return
    }
    event.dataTransfer.dropEffect = 'none'
    setDropTarget(null)
  }

  const handleTreeDrop = (targetDir: string, event: ReactDragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setAppFileDrag(false)
    setOverTree(false)
    setDropTarget(null)
    appDragDepthRef.current = 0

    if (isExternalFileDrag(event)) {
      const localPaths = pathsFromDrop(event)
      internalDragPathsRef.current = null
      if (localPaths.length === 0) {
        setError(t('fileUploadFailed'))
        return
      }
      void uploadTo(targetDir || cwd || '/', localPaths)
      return
    }

    const sources = readInternalMovePaths(event)
    internalDragPathsRef.current = null
    if (!sources?.length) return
    if (!canMovePathsTo(sources, targetDir)) {
      setError(t('fileMoveInvalid'))
      return
    }
    moveItems(sources, targetDir)
  }

  const submitNamePrompt = async () => {
    if (!sessionId || !namePrompt) return
    const name = namePrompt.value.trim()
    if (!name || name.includes('/') || name.includes('\\')) {
      setError(t('fileOpFailed'))
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const remotePath =
        namePrompt.parentPath === '/'
          ? `/${name}`
          : `${namePrompt.parentPath}/${name}`
      if (namePrompt.mode === 'mkdir') {
        await window.sshApi.fsMkdir(sessionId, remotePath)
        await refreshDir(namePrompt.parentPath)
      } else if (namePrompt.mode === 'mkfile') {
        await window.sshApi.fsWrite(sessionId, remotePath, '')
        await refreshDir(namePrompt.parentPath)
      } else if (namePrompt.fromPath) {
        await window.sshApi.fsRename(sessionId, namePrompt.fromPath, remotePath)
        await refreshDir(namePrompt.parentPath)
        clearSelection()
      }
      setNamePrompt(null)
    } catch (err) {
      setError(formatAppError(err, t, 'fileOpFailed'))
    } finally {
      setBusy(false)
    }
  }

  const copyPaths = (remotePaths: string[]) => {
    window.sshApi.clipboardWriteText(remotePaths.join('\n'))
    setActionNote(
      remotePaths.length > 1 ? t('fileCopyPaths') : t('fileCopyPath'),
    )
  }

  const clearSelection = () => {
    setSelectedPaths(new Set())
    lastSelectedRef.current = null
  }

  const pathsFromDrop = (event: ReactDragEvent) => {
    const files = Array.from(event.dataTransfer.files)
    return files
      .map((file) => {
        try {
          const fromApi = window.sshApi.getPathForFile?.(file)
          if (fromApi) return fromApi
        } catch {
          // fall through
        }
        return (file as File & { path?: string }).path
      })
      .filter((item): item is string => Boolean(item))
  }

  const handlePanelDragOver = (event: ReactDragEvent) => {
    if (!sessionId) return
    event.preventDefault()
    event.stopPropagation()
    setOverTree(true)
    if (isExternalFileDrag(event)) {
      event.dataTransfer.dropEffect = 'copy'
      setDropTarget(null)
      return
    }
    const sources = internalDragPathsRef.current
    const target = cwd || '/'
    if (sources && canMovePathsTo(sources, target)) {
      event.dataTransfer.dropEffect = 'move'
      setDropTarget(target)
      return
    }
    event.dataTransfer.dropEffect = 'none'
    setDropTarget(null)
  }

  const handlePanelDragLeave = (event: ReactDragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return
    setOverTree(false)
    setDropTarget(null)
  }

  const finishDrop = (remoteDir: string, event: ReactDragEvent) => {
    setAppFileDrag(false)
    setOverTree(false)
    setDropTarget(null)
    appDragDepthRef.current = 0
    if (!sessionId) return
    const localPaths = pathsFromDrop(event)
    if (localPaths.length === 0) {
      setError(t('fileUploadFailed'))
      return
    }
    void uploadTo(remoteDir || cwd || '/', localPaths)
  }

  const handlePanelDrop = (event: ReactDragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const targetDir = dropTarget || cwd || '/'
    if (isExternalFileDrag(event)) {
      finishDrop(targetDir, event)
      return
    }
    const sources = readInternalMovePaths(event)
    internalDragPathsRef.current = null
    setAppFileDrag(false)
    setOverTree(false)
    setDropTarget(null)
    appDragDepthRef.current = 0
    if (!sources?.length) return
    if (!canMovePathsTo(sources, targetDir)) {
      setError(t('fileMoveInvalid'))
      return
    }
    void moveItems(sources, targetDir)
  }

  const handleEntryClick = (entry: RemoteFsEntry, event: ReactMouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (entry.path === '/') return

    // Selection only with Ctrl/Cmd or Shift — plain LMB does not select.
    if (event.ctrlKey || event.metaKey) {
      setSelectedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(entry.path)) next.delete(entry.path)
        else next.add(entry.path)
        lastSelectedRef.current = entry.path
        return next
      })
      return
    }

    if (event.shiftKey && lastSelectedRef.current) {
      const anchor = lastSelectedRef.current
      const dir = parentDir(entry.path)
      if (parentDir(anchor) === dir) {
        const siblings = childrenMap[dir]?.map((item) => item.path) ?? []
        const start = siblings.indexOf(anchor)
        const end = siblings.indexOf(entry.path)
        if (start >= 0 && end >= 0) {
          const [from, to] = start < end ? [start, end] : [end, start]
          setSelectedPaths((prev) => {
            const next = new Set(prev)
            for (let i = from; i <= to; i += 1) next.add(siblings[i])
            return next
          })
          return
        }
      }
    }

    if (event.shiftKey) {
      setSelectedPaths(new Set([entry.path]))
      lastSelectedRef.current = entry.path
    }
  }

  const showContextMenu = async (entry: RemoteFsEntry) => {
    // PCM never changes selection — act on current multi-selection only if the
    // clicked item is already selected; otherwise act on that item alone.
    const targets =
      selectedPaths.has(entry.path) && selectedPaths.size > 0
        ? Array.from(selectedPaths)
        : [entry.path]

    const multi = targets.length > 1
    const singleDir = !multi && entry.isDir
    const uploadTarget = entry.isDir ? entry.path : parentDir(entry.path)
    const items = multi
      ? [
          {
            id: 'download',
            label: formatMessage(t('fileDownloadSelected'), {
              count: targets.length,
            }),
          },
          { id: 'delete', label: t('fileDelete') },
          { id: 'copyPath', label: t('fileCopyPaths') },
          { id: 'clear', label: t('fileClearSelection') },
        ]
      : [
          ...(singleDir
            ? [
                { id: 'upload', label: t('fileUploadHere') },
                { id: 'mkfile', label: t('fileNewFile') },
                { id: 'mkdir', label: t('fileNewFolder') },
                { id: 'download', label: t('fileDownloadFolder') },
              ]
            : [
                ...(isImageFile(entry.name)
                  ? [{ id: 'viewImage', label: t('fileViewImage') }]
                  : isArchiveFile(entry.name) || isArchiveFile(entry.path)
                    ? [{ id: 'openArchive', label: t('fileOpenArchive') }]
                    : [{ id: 'edit', label: t('fileEdit') }]),
                { id: 'download', label: t('fileDownload') },
              ]),
          ...(entry.path === '/'
            ? []
            : [
                { id: 'rename', label: t('fileRename') },
                { id: 'delete', label: t('fileDelete') },
              ]),
          { id: 'copyPath', label: t('fileCopyPath') },
        ]

    const action = await window.sshApi.showFileActionsMenu({ items })
    if (action === 'viewImage' && targets[0] && !entry.isDir) {
      void openViewer(targets[0])
    } else if (action === 'openArchive' && targets[0] && !entry.isDir) {
      void openArchive(targets[0])
    } else if (action === 'edit' && targets[0] && !entry.isDir) {
      void openEditor(targets[0])
    } else if (action === 'download') void downloadItems(targets)
    else if (action === 'upload') void uploadTo(uploadTarget)
    else if (action === 'mkdir') {
      setNamePrompt({
        mode: 'mkdir',
        parentPath: uploadTarget,
        value: '',
      })
    } else if (action === 'mkfile') {
      setNamePrompt({
        mode: 'mkfile',
        parentPath: uploadTarget,
        value: '',
      })
    } else if (action === 'rename' && targets[0]) {
      setNamePrompt({
        mode: 'rename',
        parentPath: parentDir(targets[0]),
        fromPath: targets[0],
        value: displayName(targets[0]),
      })
    } else if (action === 'delete') void deleteItems(targets)
    else if (action === 'copyPath') copyPaths(targets)
    else if (action === 'clear') clearSelection()
  }

  const handleEntryContextMenu = (
    entry: RemoteFsEntry,
    event: ReactMouseEvent,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    void showContextMenu(entry)
  }

  return (
    <>
      {!pinned ? (
        <div
          className={`file-tree-backdrop${open ? ' is-open' : ''}`}
          onClick={onClose}
        />
      ) : null}
      <aside
        className={`file-tree-panel${open ? ' is-open' : ''}${
          pinned ? ' is-pinned' : ''
        }${appFileDrag && !overTree ? ' is-dragover' : ''}`}
        aria-hidden={!open}
      >
        <div className="file-tree-panel__header">
          <div className="file-tree-panel__header-row">
            <div className="file-tree-panel__heading">
              <div className="file-tree-panel__title">{t('treeTitle')}</div>
              {pathEditing && sessionId ? (
                <input
                  ref={pathInputRef}
                  type="text"
                  className="file-tree-panel__cwd file-tree-panel__cwd--edit"
                  value={pathDraft}
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  aria-label={t('treePath')}
                  onChange={(ev) => setPathDraft(ev.target.value)}
                  onMouseDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => ev.stopPropagation()}
                  onBlur={() => {
                    if (!pathCommitRef.current) {
                      cancelPathEdit()
                    }
                  }}
                  onKeyDown={(ev) => {
                    ev.stopPropagation()
                    if (ev.key === 'Enter') {
                      ev.preventDefault()
                      commitPathDraft()
                    }
                    if (ev.key === 'Escape') {
                      ev.preventDefault()
                      cancelPathEdit()
                    }
                  }}
                />
              ) : (
                <div
                  className="file-tree-panel__cwd"
                  title={
                    sessionId
                      ? `${cwdLabel}\n${t('treePathHint')}`
                      : cwdLabel
                  }
                  aria-label={t('treePath')}
                  onDoubleClick={(ev) => {
                    ev.preventDefault()
                    ev.stopPropagation()
                    beginPathEdit()
                  }}
                >
                  {cwdLabel}
                </div>
              )}
            </div>
            <button
              type="button"
              className={`btn-icon file-tree-panel__pin${
                pinned ? ' is-active' : ''
              }`}
              onClick={() => onPinnedChange(!pinned)}
              title={pinned ? t('treeUnpin') : t('treePin')}
              aria-label={pinned ? t('treeUnpin') : t('treePin')}
              aria-pressed={pinned}
            >
              <svg
                className="btn-icon__svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden
              >
                <path
                  d="M15.5 3.5L20.5 8.5L14.75 10.75L13.25 16.5L10.5 13.75L6.5 17.75L6.25 17.5L10.25 13.5L7.5 10.75L13.25 9.25L15.5 3.5Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  fill={pinned ? 'currentColor' : 'none'}
                />
                <path
                  d="M10.5 13.75L6 20"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          {sessionId ? (
            <input
              type="search"
              className="file-tree-panel__search"
              value={filterQuery}
              onChange={(ev) => setFilterQuery(ev.target.value)}
              placeholder={t('treeSearch')}
              aria-label={t('treeSearch')}
            />
          ) : null}
        </div>

        <div
          ref={bodyRef}
          className="file-tree-panel__body"
          onClick={() => clearSelection()}
          onScroll={clearImageHover}
          onDragEnter={(event) => {
            if (!sessionId) return
            event.preventDefault()
            setOverTree(true)
          }}
          onDragOver={handlePanelDragOver}
          onDragLeave={handlePanelDragLeave}
          onDrop={handlePanelDrop}
        >
          {!sessionId ? (
            <div className="file-tree__meta">{t('treeConnectHint')}</div>
          ) : null}
          {sessionId ? (
            <div className="file-tree__hint">
              {appFileDrag
                ? formatMessage(t('fileDropTarget'), {
                    path: dropTarget || cwd || '/',
                  })
                : t('fileDropHint')}
            </div>
          ) : null}
          {error ? <div className="error-box">{error}</div> : null}
          {actionNote ? (
            <div className="file-tree__note">{actionNote}</div>
          ) : null}
          {sessionId ? (
            <div className="file-tree__hint">{t('fileSelectHint')}</div>
          ) : null}
          {sessionId ? (
            <div onClick={(event) => event.stopPropagation()}>
              <TreeNode
                path="/"
                depth={0}
                cwd={cwd}
                sessionId={sessionId}
                expanded={expanded}
                childrenMap={childrenMap}
                loadingPaths={loadingPaths}
                selectedPaths={selectedPaths}
                dropTarget={dropTarget}
                filterQuery={filterQuery}
                onToggle={(path) => void onToggle(path)}
                onReveal={handleReveal}
                onGo={onNavigate ? handleGo : undefined}
                onEntryClick={handleEntryClick}
                onEntryContextMenu={handleEntryContextMenu}
                onFileDoubleClick={openFile}
                onEntryDragStart={handleEntryDragStart}
                onEntryDragEnd={handleEntryDragEnd}
                onTreeDragOver={handleTreeDragOver}
                onTreeDrop={handleTreeDrop}
                onImageHoverStart={handleImageHoverStart}
                onImageHoverEnd={clearImageHover}
                goLabel={t('goTo')}
                loadingLabel={t('loading')}
                emptyLabel={
                  filterQuery.trim() ? t('treeSearchEmpty') : t('empty')
                }
              />
            </div>
          ) : null}
        </div>

        <div className="file-tree-panel__footer">
          {sessionId && selectedList.length > 0 ? (
            <div className="file-tree__selection">
              {formatMessage(t('fileSelectedCount'), {
                count: selectedList.length,
              })}
              <button
                type="button"
                className="file-tree__selection-clear"
                onClick={(event) => {
                  event.stopPropagation()
                  clearSelection()
                }}
              >
                {t('fileClearSelection')}
              </button>
            </div>
          ) : null}
          <div className="file-tree-panel__actions">
            {selectedList.length > 0 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void downloadItems(selectedList)}
                disabled={!sessionId || busy}
                title={formatMessage(t('fileDownloadSelected'), {
                  count: selectedList.length,
                })}
              >
                {formatMessage(t('fileDownloadSelected'), {
                  count: selectedList.length,
                })}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void refresh()}
              disabled={!sessionId || busy}
              title={t('refresh')}
            >
              {t('refresh')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              title={t('close')}
            >
              {t('close')}
            </button>
          </div>
        </div>
      </aside>

      {namePrompt ? (
        <div className="file-tree-prompt-backdrop" role="presentation">
          <div
            className="file-tree-prompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="file-tree-prompt-title"
          >
            <div className="field">
              <label htmlFor="file-tree-prompt-name" id="file-tree-prompt-title">
                {namePrompt.mode === 'mkdir'
                  ? t('fileFolderNamePrompt')
                  : namePrompt.mode === 'mkfile'
                    ? t('fileFileNamePrompt')
                    : t('fileNamePrompt')}
              </label>
              <input
                id="file-tree-prompt-name"
                autoFocus
                value={namePrompt.value}
                disabled={busy}
                onChange={(event) =>
                  setNamePrompt((prev) =>
                    prev ? { ...prev, value: event.target.value } : prev,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void submitNamePrompt()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setNamePrompt(null)
                  }
                }}
              />
            </div>
            <div className="file-tree-prompt__actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !namePrompt.value.trim()}
                onClick={() => void submitNamePrompt()}
              >
                {t('confirm')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setNamePrompt(null)}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmPrompt ? (
        <div
          className="file-tree-prompt-backdrop"
          role="presentation"
          onClick={() => {
            if (!busy) setConfirmPrompt(null)
          }}
        >
          <div
            className="file-tree-prompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="file-tree-confirm-title"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) {
                event.preventDefault()
                setConfirmPrompt(null)
              }
              if (event.key === 'Enter' && !busy) {
                event.preventDefault()
                void submitConfirmPrompt()
              }
            }}
          >
            <div className="field">
              <div id="file-tree-confirm-title" className="file-tree-prompt__title">
                {confirmPrompt.title}
              </div>
              <p className="file-tree-prompt__message">{confirmPrompt.message}</p>
            </div>
            <div className="file-tree-prompt__actions">
              <button
                type="button"
                className={`btn ${confirmPrompt.danger ? 'btn-danger' : 'btn-primary'}`}
                disabled={busy}
                autoFocus
                onClick={() => void submitConfirmPrompt()}
              >
                {confirmPrompt.confirmLabel}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setConfirmPrompt(null)}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {imageHover && sessionId ? (
        <ImageHoverPreview
          sessionId={sessionId}
          entry={imageHover.entry}
          anchor={imageHover.rect}
        />
      ) : null}
    </>
  )
}
