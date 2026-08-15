import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import { matchBinding } from '../hotkeys'
import { useSettings } from '../i18n/SettingsContext'
import { TAB_SIZE, type AppTheme, type HotkeysSettings, type SessionStatus } from '../types'

type Props = {
  sessionId: string | null
  shellId: string | null
  status: SessionStatus
  connectionLabel?: string
  reconnectAttempt?: number
  /** When false, skip chrome empty-state (used for inactive tabs). */
  active?: boolean
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

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function terminalTheme(theme: AppTheme) {
  if (theme === 'light') {
    // High-contrast palette for light backgrounds (dark ANSI colors).
    return {
      background: '#f8f9fb',
      foreground: '#111827',
      cursor: '#0b57d0',
      cursorAccent: '#f8f9fb',
      selectionBackground: 'rgba(11, 87, 208, 0.28)',
      selectionForeground: '#111827',
      black: '#111827',
      red: '#b91c1c',
      green: '#15803d',
      yellow: '#a16207',
      blue: '#1d4ed8',
      magenta: '#7e22ce',
      cyan: '#0e7490',
      white: '#e5e7eb',
      brightBlack: '#4b5563',
      brightRed: '#dc2626',
      brightGreen: '#166534',
      brightYellow: '#92400e',
      brightBlue: '#1e40af',
      brightMagenta: '#6b21a8',
      brightCyan: '#155e75',
      brightWhite: '#111827',
    }
  }

  return {
    background: '#0b0b0e',
    foreground: '#e8e8ed',
    cursor: '#0a84ff',
    cursorAccent: '#0b0b0e',
    selectionBackground: 'rgba(10, 132, 255, 0.35)',
    selectionForeground: '#ffffff',
    black: '#1c1c22',
    red: '#ff453a',
    green: '#30d158',
    yellow: '#ffd60a',
    blue: '#0a84ff',
    magenta: '#bf5af2',
    cyan: '#64d2ff',
    white: '#f5f5f7',
    brightBlack: '#636366',
    brightRed: '#ff6961',
    brightGreen: '#30d158',
    brightYellow: '#ffd60a',
    brightBlue: '#409cff',
    brightMagenta: '#da8fff',
    brightCyan: '#70d7ff',
    brightWhite: '#ffffff',
  }
}

export function TerminalView({
  sessionId,
  shellId,
  status,
  connectionLabel,
  reconnectAttempt = 0,
  active = true,
}: Props) {
  const { t, theme, settings } = useSettings()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const sessionRef = useRef<string | null>(null)
  const shellRef = useRef<string | null>(null)
  const statusRef = useRef<SessionStatus>(status)
  const connectionLabelRef = useRef(connectionLabel)
  const writingRef = useRef(false)
  const tRef = useRef(t)
  const hotkeysRef = useRef<HotkeysSettings>(settings.hotkeys)
  const lastReconnectNoteRef = useRef(0)
  const wasReconnectingRef = useRef(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchOpenRef = useRef(false)
  const showEmpty =
    active &&
    (!sessionId || status === 'idle' || status === 'disconnected')

  useEffect(() => {
    searchOpenRef.current = searchOpen
  }, [searchOpen])

  useEffect(() => {
    if (!searchOpen || !active) return
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [searchOpen, active])

  useEffect(() => {
    if (!active) return
    const onKeyDown = (ev: KeyboardEvent) => {
      const mod = ev.ctrlKey || ev.metaKey
      if (mod && !ev.altKey && !ev.shiftKey && ev.code === 'KeyF') {
        ev.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active])

  useEffect(() => {
    tRef.current = t
  }, [t])

  useEffect(() => {
    hotkeysRef.current = settings.hotkeys
  }, [settings.hotkeys])

  useEffect(() => {
    sessionRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    shellRef.current = shellId
  }, [shellId])

  useEffect(() => {
    connectionLabelRef.current = connectionLabel
  }, [connectionLabel])

  const writeStatusBanner = (
    term: Terminal,
    nextStatus: SessionStatus,
    attempt: number,
    options?: { reset?: boolean },
  ) => {
    const target = connectionLabelRef.current?.trim()
    term.options.disableStdin = nextStatus !== 'connected'

    if (nextStatus === 'connecting') {
      wasReconnectingRef.current = false
      lastReconnectNoteRef.current = 0
      if (options?.reset !== false) term.reset()
      term.write(
        `\x1b[90m${
          target
            ? formatMessage(tRef.current('connectingTo'), { target })
            : tRef.current('connecting')
        }\x1b[0m\r\n`,
      )
      return
    }

    if (nextStatus === 'reconnecting') {
      wasReconnectingRef.current = true
      const value = Math.max(attempt, 1)
      if (lastReconnectNoteRef.current === value) return
      lastReconnectNoteRef.current = value
      term.write(
        `\r\n\x1b[33m${formatMessage(tRef.current('reconnecting'), {
          attempt: value,
        })}\x1b[0m\r\n`,
      )
      if (target) {
        term.write(`\x1b[90m${target}\x1b[0m\r\n`)
      }
      return
    }

    if (nextStatus === 'connected') {
      const afterReconnect = wasReconnectingRef.current
      wasReconnectingRef.current = false
      lastReconnectNoteRef.current = 0
      if (afterReconnect) {
        term.write(
          `\r\n\x1b[32m${
            target
              ? formatMessage(tRef.current('connectedTo'), { target })
              : tRef.current('reconnectedOk')
          }\x1b[0m\r\n`,
        )
        const sid = sessionRef.current
        const sh = shellRef.current
        if (sid && sh) {
          window.setTimeout(() => {
            if (
              statusRef.current === 'connected' &&
              sessionRef.current === sid &&
              shellRef.current === sh
            ) {
              window.sshApi.write(sid, '\n', sh)
            }
          }, 80)
        }
        return
      }
      if (options?.reset !== false) term.reset()
      term.write(
        `\x1b[32m${
          target
            ? formatMessage(tRef.current('connectedTo'), { target })
            : tRef.current('connectedOk')
        }\x1b[0m\r\n\r\n`,
      )
    }
  }

  useEffect(() => {
    statusRef.current = status
    const term = termRef.current
    if (!term) return
    writeStatusBanner(term, status, reconnectAttempt)
  }, [status, reconnectAttempt])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = terminalTheme(theme)
    term.refresh(0, term.rows - 1)
  }, [theme])

  useEffect(() => {
    if (!containerRef.current || termRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1,
      letterSpacing: 0,
      scrollback: 5000,
      tabStopWidth: TAB_SIZE,
      theme: terminalTheme(theme),
      allowProposedApi: true,
      macOptionIsMeta: true,
      convertEol: false,
    })

    const fit = new FitAddon()
    const search = new SearchAddon()
    const unicode11 = new Unicode11Addon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(unicode11)
    term.loadAddon(new WebLinksAddon())
    term.unicode.activeVersion = '11'
    term.open(containerRef.current)

    const syncSize = () => {
      fit.fit()
      if (sessionRef.current && shellRef.current) {
        window.sshApi.resize(
          sessionRef.current,
          term.cols,
          term.rows,
          shellRef.current,
        )
      }
    }

    requestAnimationFrame(syncSize)

    termRef.current = term
    fitRef.current = fit
    searchAddonRef.current = search

    // Status effect may have run before xterm existed — paint the banner now.
    writeStatusBanner(term, statusRef.current, 0, { reset: true })

    const copySelection = () => {
      if (!term.hasSelection()) return false
      const text = term.getSelection()
      if (!text) return false
      window.sshApi.clipboardWriteText(text)
      return true
    }

    const pasteClipboard = () => {
      if (!sessionRef.current || statusRef.current !== 'connected') return
      const text = window.sshApi.clipboardReadText()
      if (!text) return
      term.paste(text)
    }

    const writeToSession = (data: string) => {
      if (
        !sessionRef.current ||
        !shellRef.current ||
        statusRef.current !== 'connected'
      ) {
        return
      }
      window.sshApi.write(sessionRef.current, data, shellRef.current)
    }

    const selectInputLine = () => {
      const buf = term.buffer.active
      const row = buf.baseY + buf.cursorY
      term.selectLines(row, row)
    }

    // Copy-on-select (PuTTY / classic SSH client behavior)
    const onSelectionChange = term.onSelectionChange(() => {
      if (term.hasSelection()) {
        copySelection()
      }
    })

    // Chromium treats Ctrl+Z/Y as Undo/Redo on xterm's textarea.
    const textarea = (
      term as Terminal & { textarea?: HTMLTextAreaElement | null }
    ).textarea

    // Track real modifier keyups. After preventDefault on Ctrl+chord, Chromium
    // can keep ev.ctrlKey=true on later keys — that turns Y into Ctrl+Y and
    // breaks nano's "Save? (y/n)" prompt (and looks like a dead keyboard).
    const mods = { ctrl: false, meta: false, alt: false, shift: false }
    const syncMod = (code: string, down: boolean) => {
      if (code === 'ControlLeft' || code === 'ControlRight') mods.ctrl = down
      if (code === 'MetaLeft' || code === 'MetaRight') mods.meta = down
      if (code === 'AltLeft' || code === 'AltRight') mods.alt = down
      if (code === 'ShiftLeft' || code === 'ShiftRight') mods.shift = down
    }
    const onModKeyDown = (ev: KeyboardEvent) => syncMod(ev.code, true)
    const onModKeyUp = (ev: KeyboardEvent) => syncMod(ev.code, false)
    const onModReset = () => {
      mods.ctrl = false
      mods.meta = false
      mods.alt = false
      mods.shift = false
    }

    const effectiveEvent = (ev: KeyboardEvent): KeyboardEvent => {
      if (
        !!ev.ctrlKey === mods.ctrl &&
        !!ev.metaKey === mods.meta &&
        !!ev.altKey === mods.alt &&
        !!ev.shiftKey === mods.shift
      ) {
        return ev
      }
      // Ghost modifiers: expose physical state to matchBinding / handlers
      return new Proxy(ev, {
        get(target, prop, receiver) {
          if (prop === 'ctrlKey') return mods.ctrl
          if (prop === 'metaKey') return mods.meta
          if (prop === 'altKey') return mods.alt
          if (prop === 'shiftKey') return mods.shift
          const value = Reflect.get(target, prop, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      }) as KeyboardEvent
    }

    const onBeforeInput = (ev: InputEvent) => {
      if (
        ev.inputType === 'historyUndo' ||
        ev.inputType === 'historyRedo'
      ) {
        ev.preventDefault()
      }
    }

    // Capture-phase: deliver suspend before Chromium undo steals it.
    const onTextareaKeyDownCapture = (ev: KeyboardEvent) => {
      syncMod(ev.code, true)
      const hk = hotkeysRef.current
      if (!matchBinding(effectiveEvent(ev), hk.suspend)) return
      ev.preventDefault()
      ev.stopImmediatePropagation()
      writeToSession('\x1a')
    }

    textarea?.addEventListener('beforeinput', onBeforeInput)
    textarea?.addEventListener('keydown', onTextareaKeyDownCapture, true)
    window.addEventListener('keydown', onModKeyDown, true)
    window.addEventListener('keyup', onModKeyUp, true)
    window.addEventListener('blur', onModReset)
    textarea?.addEventListener('blur', onModReset)

    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type === 'keyup') {
        syncMod(ev.code, false)
        return true
      }
      if (ev.type !== 'keydown') return true

      syncMod(ev.code, true)
      const keyEv = effectiveEvent(ev)
      const hk = hotkeysRef.current

      const consume = () => {
        ev.preventDefault()
        ev.stopPropagation()
        return false
      }

      // Already handled in textarea capture
      if (matchBinding(keyEv, hk.suspend)) {
        return false
      }

      if (matchBinding(keyEv, hk.selectLine)) {
        selectInputLine()
        return consume()
      }

      if (matchBinding(keyEv, hk.copy)) {
        if (copySelection()) {
          term.clearSelection()
          return consume()
        }
        // No selection → let xterm send Ctrl+C to the PTY (SIGINT / nano cancel)
        return true
      }

      if (matchBinding(keyEv, hk.paste)) {
        pasteClipboard()
        return consume()
      }

      if (matchBinding(keyEv, hk.interrupt)) {
        writeToSession('\x03')
        return consume()
      }

      // Ctrl/Cmd+F → terminal find (not form-feed)
      if (
        (keyEv.ctrlKey || keyEv.metaKey) &&
        !keyEv.altKey &&
        !keyEv.shiftKey &&
        keyEv.code === 'KeyF'
      ) {
        setSearchOpen(true)
        return consume()
      }

      if (ev.code === 'Escape' && searchOpenRef.current) {
        setSearchOpen(false)
        return consume()
      }

      // Classic Windows terminal extras
      if (keyEv.ctrlKey && !keyEv.shiftKey && !keyEv.altKey && ev.code === 'Insert') {
        copySelection()
        return consume()
      }
      if (keyEv.shiftKey && !keyEv.ctrlKey && !keyEv.altKey && ev.code === 'Insert') {
        pasteClipboard()
        return consume()
      }

      // Do NOT intercept remaining Ctrl+A–Z here. Manually writing control
      // chars + preventDefault makes Chromium "stick" Ctrl, so the next Y/N
      // in nano becomes Ctrl+Y / Ctrl+N and the prompt looks frozen.
      // xterm's onData already forwards real Ctrl chords to the PTY.

      return true
    })

    // Right-click pastes (Windows Terminal / PuTTY)
    const host = containerRef.current
    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault()
      pasteClipboard()
    }
    host.addEventListener('contextmenu', onContextMenu)

    const onData = term.onData((data) => {
      if (
        !sessionRef.current ||
        !shellRef.current ||
        statusRef.current !== 'connected'
      ) {
        return
      }
      if (writingRef.current) return
      writingRef.current = true
      try {
        window.sshApi.write(sessionRef.current, data, shellRef.current)
      } finally {
        writingRef.current = false
      }
    })

    const offData = window.sshApi.onData(
      (incomingSessionId, data, incomingShellId) => {
        if (incomingSessionId !== sessionRef.current) return
        if (incomingShellId && incomingShellId !== shellRef.current) return
        if (statusRef.current !== 'connected') return
        term.write(decodeBase64(data))
      },
    )

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(syncSize)
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      onSelectionChange.dispose()
      textarea?.removeEventListener('beforeinput', onBeforeInput)
      textarea?.removeEventListener('keydown', onTextareaKeyDownCapture, true)
      window.removeEventListener('keydown', onModKeyDown, true)
      window.removeEventListener('keyup', onModKeyUp, true)
      window.removeEventListener('blur', onModReset)
      textarea?.removeEventListener('blur', onModReset)
      host.removeEventListener('contextmenu', onContextMenu)
      onData.dispose()
      offData()
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      searchAddonRef.current = null
    }
    // theme is applied only at create; later changes handled by separate effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runSearch = (direction: 'next' | 'prev') => {
    const addon = searchAddonRef.current
    const query = searchQuery.trim()
    if (!addon || !query) return
    const opts = { caseSensitive: false, incremental: false }
    if (direction === 'next') addon.findNext(query, opts)
    else addon.findPrevious(query, opts)
  }

  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) return
    searchAddonRef.current?.findNext(searchQuery.trim(), {
      caseSensitive: false,
      incremental: true,
    })
  }, [searchQuery, searchOpen])

  useEffect(() => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit || !sessionId || !shellId) return
    requestAnimationFrame(() => {
      fit.fit()
      window.sshApi.resize(sessionId, term.cols, term.rows, shellId)
    })
  }, [sessionId, shellId])

  useEffect(() => {
    if (showEmpty || !active) return
    const fit = fitRef.current
    const term = termRef.current
    if (!fit || !term) return
    requestAnimationFrame(() => {
      fit.fit()
      if (sessionId && shellId) {
        window.sshApi.resize(sessionId, term.cols, term.rows, shellId)
      }
    })
  }, [showEmpty, sessionId, shellId, active])

  return (
    <div className={`terminal-wrap${active ? '' : ' is-hidden'}`}>
      {showEmpty ? (
        <div className="terminal-empty">
          <h2>{t('readyToConnect')}</h2>
          <p>{t('readyToConnectHint')}</p>
        </div>
      ) : null}
      {!showEmpty && searchOpen ? (
        <div className="terminal-search" role="search">
          <input
            ref={searchInputRef}
            className="terminal-search__input"
            type="search"
            value={searchQuery}
            placeholder={t('terminalSearch')}
            aria-label={t('terminalSearch')}
            onChange={(ev) => setSearchQuery(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault()
                runSearch(ev.shiftKey ? 'prev' : 'next')
              }
              if (ev.key === 'Escape') {
                ev.preventDefault()
                setSearchOpen(false)
                termRef.current?.focus()
              }
              if (ev.key === 'F3') {
                ev.preventDefault()
                runSearch(ev.shiftKey ? 'prev' : 'next')
              }
            }}
          />
          <button
            type="button"
            className="terminal-search__btn"
            title={t('terminalSearchPrev')}
            aria-label={t('terminalSearchPrev')}
            onClick={() => runSearch('prev')}
          >
            ↑
          </button>
          <button
            type="button"
            className="terminal-search__btn"
            title={t('terminalSearchNext')}
            aria-label={t('terminalSearchNext')}
            onClick={() => runSearch('next')}
          >
            ↓
          </button>
          <button
            type="button"
            className="terminal-search__btn"
            title={t('terminalSearchClose')}
            aria-label={t('terminalSearchClose')}
            onClick={() => {
              setSearchOpen(false)
              termRef.current?.focus()
            }}
          >
            ×
          </button>
        </div>
      ) : null}
      <div
        className="terminal-host"
        style={{
          visibility: showEmpty ? 'hidden' : 'visible',
          position: showEmpty ? 'absolute' : 'relative',
          inset: showEmpty ? 0 : undefined,
          background: 'var(--terminal-bg)',
        }}
        aria-label={connectionLabel ?? 'Terminal'}
      >
        <div ref={containerRef} className="terminal-fit" />
      </div>
    </div>
  )
}
