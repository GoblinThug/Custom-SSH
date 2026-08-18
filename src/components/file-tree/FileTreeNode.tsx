import {
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import type { RemoteFsEntry } from '../../types'
import { isImageFile } from '../../imageFiles'
import { isArchiveFile } from '../../archiveFiles'
import { isAudioFile } from '../../audioFiles'
import { isVideoFile } from '../../videoFiles'
import { ChevronIcon } from '../ChevronIcon'
import {
  ArchiveFileIcon,
  AudioFileIcon,
  FileIcon,
  FolderIcon,
  ImageFileIcon,
  VideoFileIcon,
} from './icons'
import { displayName, entryMatchesFilter, parentChain, parentDir } from './paths'

export function FileTreeNode({
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
              <FileTreeNode
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
