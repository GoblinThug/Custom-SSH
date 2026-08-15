import { useMemo, useState, type CSSProperties } from 'react'
import { FOLDER_COLORS, folderColorValue } from '../folderColors'
import { useSettings } from '../i18n/SettingsContext'
import { ChevronIcon } from './ChevronIcon'
import type {
  ConnectionFolder,
  FolderColor,
  SavedConnection,
} from '../types'

type Props = {
  folders: ConnectionFolder[]
  connections: SavedConnection[]
  selectedId?: string
  query: string
  onQueryChange: (value: string) => void
  onSelect: (connection: SavedConnection) => void
  onConnect: (connection: SavedConnection) => void
  onNew: () => void
  onCreateFolder: () => void
  onRenameFolder: (folderId: string, name: string) => void
  onChangeFolderColor: (folderId: string, color: FolderColor) => void
  onDeleteFolder: (folderId: string) => void
  onMoveConnection: (connectionId: string, folderId: string | null) => void
  onOpenSettings: () => void
  onOpenHotkeys: () => void
}

export function Sidebar({
  folders,
  connections,
  selectedId,
  query,
  onQueryChange,
  onSelect,
  onConnect,
  onNew,
  onCreateFolder,
  onRenameFolder,
  onChangeFolderColor,
  onDeleteFolder,
  onMoveConnection,
  onOpenSettings,
  onOpenHotkeys,
}: Props) {
  const { t } = useSettings()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [colorPickerId, setColorPickerId] = useState<string | null>(null)
  const [menuConnectionId, setMenuConnectionId] = useState<string | null>(null)

  const q = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!q) return connections
    return connections.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.host.toLowerCase().includes(q) ||
        item.username.toLowerCase().includes(q),
    )
  }, [connections, q])

  const ungrouped = filtered.filter((item) => !item.folderId)

  const startRename = (folder: ConnectionFolder) => {
    setRenamingId(folder.id)
    setRenameValue(folder.name)
    setColorPickerId(null)
  }

  const commitRename = () => {
    if (!renamingId) return
    const next = renameValue.trim()
    if (next) onRenameFolder(renamingId, next)
    setRenamingId(null)
    setRenameValue('')
  }

  const renderConnection = (item: SavedConnection) => (
    <div
      key={item.id}
      className={`connection-row${selectedId === item.id ? ' is-active' : ''}`}
    >
      <button
        type="button"
        className={`connection-item${selectedId === item.id ? ' is-active' : ''}`}
        onClick={() => {
          setMenuConnectionId(null)
          onSelect(item)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenuConnectionId((id) => (id === item.id ? null : item.id))
        }}
      >
        <div className="connection-item__name">{item.name}</div>
        <div className="connection-item__meta">
          {item.username}@{item.host}:{item.port}
        </div>
      </button>
      <button
        type="button"
        className="connection-row__connect"
        title={t('connect')}
        aria-label={t('connect')}
        onClick={(e) => {
          e.stopPropagation()
          setMenuConnectionId(null)
          onConnect(item)
        }}
      >
        <svg
          className="connection-row__connect-icon"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <path
            d="M21.4086 9.35258C23.5305 10.5065 23.5305 13.4935 21.4086 14.6474L8.59662 21.6145C6.53435 22.736 4 21.2763 4 18.9671L4 5.0329C4 2.72368 6.53435 1.26402 8.59661 2.38548L21.4086 9.35258Z"
            fill="currentColor"
          />
        </svg>
      </button>

      {menuConnectionId === item.id ? (
        <div
          className="connection-menu"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="connection-menu__label">{t('moveTo')}</div>
          <button
            type="button"
            className={!item.folderId ? 'is-current' : undefined}
            onClick={() => {
              onMoveConnection(item.id, null)
              setMenuConnectionId(null)
            }}
          >
            {t('noFolder')}
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className={item.folderId === folder.id ? 'is-current' : undefined}
              onClick={() => {
                onMoveConnection(item.id, folder.id)
                setMenuConnectionId(null)
              }}
            >
              <span
                className="folder-dot"
                style={{ background: folderColorValue(folder.color) }}
              />
              {folder.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )

  return (
    <aside className="sidebar" onClick={() => setMenuConnectionId(null)}>
      <div className="sidebar__header">
        <div className="sidebar__title">{t('connections')}</div>
        <div className="sidebar__header-actions">
          <button
            className="btn-icon"
            onClick={onCreateFolder}
            title={t('newFolder')}
            aria-label={t('newFolder')}
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
                fillRule="evenodd"
                clipRule="evenodd"
                d="M2.06935 5.00839C2 5.37595 2 5.81722 2 6.69975V13.75C2 17.5212 2 19.4069 3.17157 20.5784C4.34315 21.75 6.22876 21.75 10 21.75H14C17.7712 21.75 19.6569 21.75 20.8284 20.5784C22 19.4069 22 17.5212 22 13.75V11.5479C22 8.91554 22 7.59935 21.2305 6.74383C21.1598 6.66514 21.0849 6.59024 21.0062 6.51946C20.1506 5.75 18.8345 5.75 16.2021 5.75H15.8284C14.6747 5.75 14.0979 5.75 13.5604 5.59678C13.2651 5.5126 12.9804 5.39471 12.7121 5.24543C12.2237 4.97367 11.8158 4.56578 11 3.75L10.4497 3.19975C10.1763 2.92633 10.0396 2.78961 9.89594 2.67051C9.27652 2.15704 8.51665 1.84229 7.71557 1.76738C7.52976 1.75 7.33642 1.75 6.94975 1.75C6.06722 1.75 5.62595 1.75 5.25839 1.81935C3.64031 2.12464 2.37464 3.39031 2.06935 5.00839ZM12 11C12.4142 11 12.75 11.3358 12.75 11.75V13H14C14.4142 13 14.75 13.3358 14.75 13.75C14.75 14.1642 14.4142 14.5 14 14.5H12.75V15.75C12.75 16.1642 12.4142 16.5 12 16.5C11.5858 16.5 11.25 16.1642 11.25 15.75V14.5H10C9.58579 14.5 9.25 14.1642 9.25 13.75C9.25 13.3358 9.58579 13 10 13H11.25V11.75C11.25 11.3358 11.5858 11 12 11Z"
                fill="currentColor"
              />
            </svg>
          </button>
          <button
            className="btn-icon"
            onClick={onNew}
            title={t('newConnection')}
            aria-label={t('newConnection')}
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
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22ZM12.75 9C12.75 8.58579 12.4142 8.25 12 8.25C11.5858 8.25 11.25 8.58579 11.25 9L11.25 11.25H9C8.58579 11.25 8.25 11.5858 8.25 12C8.25 12.4142 8.58579 12.75 9 12.75H11.25V15C11.25 15.4142 11.5858 15.75 12 15.75C12.4142 15.75 12.75 15.4142 12.75 15L12.75 12.75H15C15.4142 12.75 15.75 12.4142 15.75 12C15.75 11.5858 15.4142 11.25 15 11.25H12.75V9Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="sidebar__search">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('search')}
        />
      </div>

      <div className="sidebar__list">
        {folders.length === 0 && filtered.length === 0 ? (
          <div className="sidebar__empty">
            {t('noConnections')}
            <br />
            {t('noConnectionsHint')}
          </div>
        ) : null}

        {folders.map((folder) => {
          const items = filtered.filter((item) => item.folderId === folder.id)
          if (q && items.length === 0) return null
          const isCollapsed = collapsed[folder.id]
          const isRenaming = renamingId === folder.id

          const color = folderColorValue(folder.color)

          return (
            <div
              key={folder.id}
              className="folder-block"
              style={
                {
                  '--folder-color': color,
                  '--folder-tint': `${color}14`,
                  '--folder-tint-strong': `${color}1f`,
                } as CSSProperties
              }
            >
              <div className="folder-row folder-row--colored">
                <button
                  type="button"
                  className="folder-row__toggle"
                  onClick={(e) => {
                    e.stopPropagation()
                    setCollapsed((prev) => ({
                      ...prev,
                      [folder.id]: !prev[folder.id],
                    }))
                  }}
                  title={isCollapsed ? t('expand') : t('collapse')}
                >
                  <ChevronIcon open={!isCollapsed} />
                </button>

                <button
                  type="button"
                  className="folder-row__swatch"
                  style={{ background: color }}
                  title={t('changeColor')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setColorPickerId((id) =>
                      id === folder.id ? null : folder.id,
                    )
                  }}
                />

                {isRenaming ? (
                  <input
                    className="folder-row__rename"
                    value={renameValue}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') {
                        setRenamingId(null)
                        setRenameValue('')
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="folder-row__name"
                    onClick={(e) => {
                      e.stopPropagation()
                      setCollapsed((prev) => ({
                        ...prev,
                        [folder.id]: !prev[folder.id],
                      }))
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      startRename(folder)
                    }}
                    title={t('doubleClickRename')}
                  >
                    {folder.name}
                    <span className="folder-row__count">{items.length}</span>
                  </button>
                )}

                <button
                  type="button"
                  className="folder-row__action"
                  title={t('rename')}
                  aria-label={t('rename')}
                  onClick={(e) => {
                    e.stopPropagation()
                    startRename(folder)
                  }}
                >
                  <svg
                    className="folder-row__action-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden
                  >
                    <path
                      d="M21.1938 2.80624C22.2687 3.88124 22.2687 5.62415 21.1938 6.69914L20.6982 7.19469C20.5539 7.16345 20.3722 7.11589 20.1651 7.04404C19.6108 6.85172 18.8823 6.48827 18.197 5.803C17.5117 5.11774 17.1483 4.38923 16.956 3.8349C16.8841 3.62781 16.8366 3.44609 16.8053 3.30179L17.3009 2.80624C18.3759 1.73125 20.1188 1.73125 21.1938 2.80624Z"
                      fill="currentColor"
                    />
                    <path
                      d="M14.5801 13.3128C14.1761 13.7168 13.9741 13.9188 13.7513 14.0926C13.4886 14.2975 13.2043 14.4732 12.9035 14.6166C12.6485 14.7381 12.3775 14.8284 11.8354 15.0091L8.97709 15.9619C8.71035 16.0508 8.41626 15.9814 8.21744 15.7826C8.01862 15.5837 7.9492 15.2897 8.03811 15.0229L8.99089 12.1646C9.17157 11.6225 9.26191 11.3515 9.38344 11.0965C9.52679 10.7957 9.70249 10.5114 9.90743 10.2487C10.0812 10.0259 10.2832 9.82394 10.6872 9.41993L15.6033 4.50385C15.867 5.19804 16.3293 6.05663 17.1363 6.86366C17.9434 7.67069 18.802 8.13296 19.4962 8.39674L14.5801 13.3128Z"
                      fill="currentColor"
                    />
                    <path
                      d="M20.5355 20.5355C22 19.0711 22 16.714 22 12C22 10.4517 22 9.15774 21.9481 8.0661L15.586 14.4283C15.2347 14.7797 14.9708 15.0437 14.6738 15.2753C14.3252 15.5473 13.948 15.7804 13.5488 15.9706C13.2088 16.1327 12.8546 16.2506 12.3833 16.4076L9.45143 17.3849C8.64568 17.6535 7.75734 17.4438 7.15678 16.8432C6.55621 16.2427 6.34651 15.3543 6.61509 14.5486L7.59235 11.6167C7.74936 11.1454 7.86732 10.7912 8.02935 10.4512C8.21958 10.052 8.45272 9.6748 8.72466 9.32615C8.9563 9.02918 9.22032 8.76528 9.57173 8.41404L15.9339 2.05188C14.8423 2 13.5483 2 12 2C7.28595 2 4.92893 2 3.46447 3.46447C2 4.92893 2 7.28595 2 12C2 16.714 2 19.0711 3.46447 20.5355C4.92893 22 7.28595 22 12 22C16.714 22 19.0711 22 20.5355 20.5355Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className="folder-row__action folder-row__action--danger"
                  title={t('deleteFolder')}
                  aria-label={t('deleteFolder')}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteFolder(folder.id)
                  }}
                >
                  <svg
                    className="folder-row__action-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden
                  >
                    <path
                      d="M2.75 6.16667C2.75 5.70644 3.09538 5.33335 3.52143 5.33335L6.18567 5.3329C6.71502 5.31841 7.18202 4.95482 7.36214 4.41691C7.36688 4.40277 7.37232 4.38532 7.39185 4.32203L7.50665 3.94993C7.5769 3.72179 7.6381 3.52303 7.72375 3.34536C8.06209 2.64349 8.68808 2.1561 9.41147 2.03132C9.59457 1.99973 9.78848 1.99987 10.0111 2.00002H13.4891C13.7117 1.99987 13.9056 1.99973 14.0887 2.03132C14.8121 2.1561 15.4381 2.64349 15.7764 3.34536C15.8621 3.52303 15.9233 3.72179 15.9935 3.94993L16.1083 4.32203C16.1279 4.38532 16.1333 4.40277 16.138 4.41691C16.3182 4.95482 16.8778 5.31886 17.4071 5.33335H19.9786C20.4046 5.33335 20.75 5.70644 20.75 6.16667C20.75 6.62691 20.4046 7 19.9786 7H3.52143C3.09538 7 2.75 6.62691 2.75 6.16667Z"
                      fill="currentColor"
                    />
                    <path
                      d="M11.6068 21.9998H12.3937C15.1012 21.9998 16.4549 21.9998 17.3351 21.1366C18.2153 20.2734 18.3054 18.8575 18.4855 16.0256L18.745 11.945C18.8427 10.4085 18.8916 9.6402 18.45 9.15335C18.0084 8.6665 17.2628 8.6665 15.7714 8.6665H8.22905C6.73771 8.6665 5.99204 8.6665 5.55047 9.15335C5.10891 9.6402 5.15777 10.4085 5.25549 11.945L5.515 16.0256C5.6951 18.8575 5.78515 20.2734 6.66534 21.1366C7.54553 21.9998 8.89927 21.9998 11.6068 21.9998Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              </div>

              {colorPickerId === folder.id ? (
                <div
                  className="color-picker"
                  onClick={(e) => e.stopPropagation()}
                >
                  {FOLDER_COLORS.map((swatch) => (
                    <button
                      key={swatch.id}
                      type="button"
                      className={`color-picker__swatch${
                        folder.color === swatch.id ? ' is-active' : ''
                      }`}
                      style={{ background: swatch.value }}
                      title={swatch.label}
                      onClick={() => {
                        onChangeFolderColor(folder.id, swatch.id)
                        setColorPickerId(null)
                      }}
                    />
                  ))}
                </div>
              ) : null}

              {!isCollapsed ? (
                <div className="folder-children">
                  {items.length === 0 ? (
                    <div className="folder-empty">{t('emptyFolder')}</div>
                  ) : (
                    items.map(renderConnection)
                  )}
                </div>
              ) : null}
            </div>
          )
        })}

        {(ungrouped.length > 0 || folders.length > 0) && (!q || ungrouped.length > 0) ? (
          <div className="folder-block">
            <div className="folder-row folder-row--muted">
              <span className="folder-row__toggle is-static">
                <ChevronIcon open />
              </span>
              <span
                className="folder-row__swatch folder-row__swatch--muted"
              />
              <span className="folder-row__name is-static">
                {t('noFolder')}
                <span className="folder-row__count">{ungrouped.length}</span>
              </span>
            </div>
            <div className="folder-children">
              {ungrouped.length === 0 ? (
                <div className="folder-empty">{t('noUngrouped')}</div>
              ) : (
                ungrouped.map(renderConnection)
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="sidebar__footer">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={(e) => {
            e.stopPropagation()
            onOpenHotkeys()
          }}
        >
          {t('hotkeys')}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={(e) => {
            e.stopPropagation()
            onOpenSettings()
          }}
        >
          {t('settings')}
        </button>
      </div>
    </aside>
  )
}
