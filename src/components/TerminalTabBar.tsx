import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { TerminalTab } from '../session/types'
import { reorderTabs } from '../session/types'
import type { MessageKey } from '../i18n/messages'

type Props = {
  tabs: TerminalTab[]
  activeTabKey: string | null
  openingShell: boolean
  canAddShell: boolean
  t: (key: MessageKey) => string
  onActivate: (tabKey: string) => void
  onCloseTab: (tabKey: string) => void
  onOpenShell: () => void
  onTabsChange: Dispatch<SetStateAction<TerminalTab[]>>
}

export function TerminalTabBar({
  tabs,
  activeTabKey,
  openingShell,
  canAddShell,
  t,
  onActivate,
  onCloseTab,
  onOpenShell,
  onTabsChange,
}: Props) {
  const [renamingTabKey, setRenamingTabKey] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [draggingTabKey, setDraggingTabKey] = useState<string | null>(null)
  const [dragOverTabKey, setDragOverTabKey] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!renamingTabKey) return
    const input = renameInputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [renamingTabKey])

  const beginRenameTab = (tabKey: string, title: string) => {
    onActivate(tabKey)
    setRenamingTabKey(tabKey)
    setRenameDraft(title)
  }

  const commitRenameTab = () => {
    if (!renamingTabKey) return
    const next = renameDraft.trim()
    if (next) {
      onTabsChange((prev) =>
        prev.map((tab) =>
          tab.key === renamingTabKey ? { ...tab, title: next } : tab,
        ),
      )
    }
    setRenamingTabKey(null)
    setRenameDraft('')
  }

  const cancelRenameTab = () => {
    setRenamingTabKey(null)
    setRenameDraft('')
  }

  if (tabs.length === 0) return null

  return (
    <div className="terminal-tabs" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.key}
          className={`terminal-tab${
            tab.key === activeTabKey ? ' is-active' : ''
          }${renamingTabKey === tab.key ? ' is-renaming' : ''}${
            tab.pending ? ' is-pending' : ''
          }${draggingTabKey === tab.key ? ' is-dragging' : ''}${
            dragOverTabKey === tab.key ? ' is-drag-over' : ''
          }`}
          role="tab"
          aria-selected={tab.key === activeTabKey}
          draggable={renamingTabKey !== tab.key}
          onDragStart={(ev) => {
            if (renamingTabKey === tab.key) {
              ev.preventDefault()
              return
            }
            ev.dataTransfer.effectAllowed = 'move'
            ev.dataTransfer.setData('text/plain', tab.key)
            setDraggingTabKey(tab.key)
          }}
          onDragEnd={() => {
            setDraggingTabKey(null)
            setDragOverTabKey(null)
          }}
          onDragOver={(ev) => {
            if (!draggingTabKey || draggingTabKey === tab.key) return
            ev.preventDefault()
            ev.dataTransfer.dropEffect = 'move'
            setDragOverTabKey(tab.key)
          }}
          onDragLeave={(ev) => {
            if (ev.currentTarget.contains(ev.relatedTarget as Node)) {
              return
            }
            if (dragOverTabKey === tab.key) {
              setDragOverTabKey(null)
            }
          }}
          onDrop={(ev) => {
            ev.preventDefault()
            const fromKey =
              ev.dataTransfer.getData('text/plain') || draggingTabKey
            if (!fromKey) return
            onTabsChange((prev) => reorderTabs(prev, fromKey, tab.key))
            setDraggingTabKey(null)
            setDragOverTabKey(null)
          }}
        >
          {renamingTabKey === tab.key ? (
            <input
              ref={renameInputRef}
              className="terminal-tab__rename"
              value={renameDraft}
              aria-label={t('terminalRenameTab')}
              onChange={(ev) => setRenameDraft(ev.target.value)}
              onClick={(ev) => ev.stopPropagation()}
              onBlur={() => commitRenameTab()}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') {
                  ev.preventDefault()
                  commitRenameTab()
                }
                if (ev.key === 'Escape') {
                  ev.preventDefault()
                  cancelRenameTab()
                }
              }}
            />
          ) : (
            <span
              className="terminal-tab__label"
              title={
                tab.label
                  ? `${tab.title} — ${tab.label}`
                  : t('terminalRenameTab')
              }
              onClick={() => onActivate(tab.key)}
              onDoubleClick={(ev) => {
                ev.preventDefault()
                beginRenameTab(tab.key, tab.title)
              }}
            >
              {tab.title}
              {tab.pending ? '…' : ''}
            </span>
          )}
          <button
            type="button"
            className="terminal-tab__close"
            title={t('terminalCloseTab')}
            aria-label={t('terminalCloseTab')}
            draggable={false}
            onMouseDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => {
              ev.stopPropagation()
              if (renamingTabKey === tab.key) {
                cancelRenameTab()
              }
              onCloseTab(tab.key)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="terminal-tab__add"
        title={t('terminalNewTab')}
        aria-label={t('terminalNewTab')}
        disabled={openingShell || !canAddShell}
        onClick={() => void onOpenShell()}
      >
        +
      </button>
    </div>
  )
}
