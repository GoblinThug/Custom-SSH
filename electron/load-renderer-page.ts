import path from 'node:path'
import type { BrowserWindow } from 'electron'

const PAGE_FILES = {
  editor: 'editor.html',
  viewer: 'viewer.html',
  archive: 'archive.html',
  tray: 'tray.html',
} as const

export type SecondaryRendererPage = keyof typeof PAGE_FILES

/** Load a secondary renderer HTML page (dev server or packaged dist). */
export async function loadRendererPage(
  win: BrowserWindow,
  page: SecondaryRendererPage,
  query?: Record<string, string>,
): Promise<void> {
  const file = PAGE_FILES[page]
  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(`/${file}`, process.env.VITE_DEV_SERVER_URL)
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value)
      }
    }
    await win.loadURL(url.toString())
    return
  }
  await win.loadFile(path.join(__dirname, '../dist', file), {
    query: query ?? {},
  })
}
