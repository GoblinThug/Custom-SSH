import { describe, expect, it } from 'vitest'
import { isArchiveFile } from './archiveFiles'
import { formatBytes, imageMimeType, isImageFile } from './imageFiles'
import { isAudioFile } from './audioFiles'
import { isVideoFile } from './videoFiles'

describe('file type helpers', () => {
  it('detects archives including compound extensions', () => {
    expect(isArchiveFile('a.tar.gz')).toBe(true)
    expect(isArchiveFile('/tmp/backup.zip')).toBe(true)
    expect(isArchiveFile('notes.txt')).toBe(false)
  })

  it('detects images and mime types', () => {
    expect(isImageFile('photo.PNG')).toBe(true)
    expect(isImageFile('photo.txt')).toBe(false)
    expect(imageMimeType('a.webp')).toBe('image/webp')
    expect(imageMimeType('a.svg')).toBe('image/svg+xml')
  })

  it('formatBytes', () => {
    expect(formatBytes(800)).toBe('800 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.00 MB')
  })

  it('detects audio and video by basename', () => {
    expect(isAudioFile('/music/track.flac')).toBe(true)
    expect(isAudioFile('track.txt')).toBe(false)
    expect(isVideoFile('clip.mkv')).toBe(true)
    expect(isVideoFile('clip.png')).toBe(false)
  })
})
