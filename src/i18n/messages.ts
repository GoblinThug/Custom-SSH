import type { AppLocale } from '../types'

export type MessageKey =
  | 'appName'
  | 'connections'
  | 'newFolder'
  | 'newConnection'
  | 'search'
  | 'settings'
  | 'hotkeys'
  | 'hotkeysTitle'
  | 'hotkeysHint'
  | 'hotkeysPress'
  | 'hotkeysReset'
  | 'hotkeysConflict'
  | 'hotkeyCopy'
  | 'hotkeyPaste'
  | 'hotkeySelectLine'
  | 'hotkeyInterrupt'
  | 'hotkeySuspend'
  | 'fileEdit'
  | 'fileDownload'
  | 'fileDownloadFolder'
  | 'fileDownloadSelected'
  | 'fileCopyPath'
  | 'fileCopyPaths'
  | 'fileClearSelection'
  | 'fileSelectedCount'
  | 'fileDownloadOk'
  | 'fileDownloadManyOk'
  | 'fileDownloadFailed'
  | 'fileSelectHint'
  | 'fileUploadHere'
  | 'fileUploadOk'
  | 'fileUploadManyOk'
  | 'fileUploadFailed'
  | 'fileTransferCancel'
  | 'fileTransferPending'
  | 'fileTransferActive'
  | 'fileTransferDone'
  | 'fileTransferCancelled'
  | 'fileTransferCancelledOk'
  | 'fileTransferPartialOk'
  | 'fileUploadQueued'
  | 'transferDockTitle'
  | 'transferDockUploading'
  | 'transferDockDownloading'
  | 'transferDockMixed'
  | 'transferDockIdle'
  | 'transferDockClear'
  | 'transferDockBatchUpload'
  | 'transferDockBatchDownload'
  | 'transferDockCancelledCount'
  | 'fileNewFolder'
  | 'fileNewFile'
  | 'fileFileNamePrompt'
  | 'fileRename'
  | 'fileDelete'
  | 'fileDeleteConfirm'
  | 'fileDeleteConfirmMany'
  | 'fileNamePrompt'
  | 'fileFolderNamePrompt'
  | 'fileDropHint'
  | 'fileDropTarget'
  | 'fileOpFailed'
  | 'fileDeleteOk'
  | 'cancel'
  | 'confirm'
  | 'editorSave'
  | 'editorSaving'
  | 'editorSaveFailed'
  | 'editorLoadFailed'
  | 'editorMissingParams'
  | 'editorStatusSaved'
  | 'editorStatusUnsaved'
  | 'editorUnsavedTitle'
  | 'editorUnsavedMessage'
  | 'editorUnsavedDetail'
  | 'editorSaveAndClose'
  | 'editorDiscard'
  | 'editorKeepEditing'
  | 'editorFind'
  | 'editorFindPlaceholder'
  | 'editorReplace'
  | 'editorReplacePlaceholder'
  | 'editorFindNext'
  | 'editorFindPrev'
  | 'editorFindAll'
  | 'editorMatchCase'
  | 'editorMatchCaseTip'
  | 'editorRegexp'
  | 'editorRegexpTip'
  | 'editorByWord'
  | 'editorByWordTip'
  | 'editorReplaceOne'
  | 'editorReplaceAll'
  | 'editorFindClose'
  | 'editorClearField'
  | 'editorGoToLine'
  | 'editorGo'
  | 'noConnections'
  | 'noConnectionsHint'
  | 'expand'
  | 'collapse'
  | 'changeColor'
  | 'rename'
  | 'deleteFolder'
  | 'doubleClickRename'
  | 'emptyFolder'
  | 'noFolder'
  | 'noUngrouped'
  | 'moveTo'
  | 'editConnection'
  | 'newConnectionHeading'
  | 'name'
  | 'folder'
  | 'host'
  | 'port'
  | 'username'
  | 'authentication'
  | 'password'
  | 'privateKey'
  | 'authPassword'
  | 'authPrivateKey'
  | 'passphrase'
  | 'browse'
  | 'connect'
  | 'save'
  | 'delete'
  | 'namePlaceholder'
  | 'passwordKeep'
  | 'passphraseKeep'
  | 'untitledConnection'
  | 'configureHost'
  | 'directoryTree'
  | 'disconnect'
  | 'ping'
  | 'pingMeasuring'
  | 'statusIdle'
  | 'statusConnecting'
  | 'statusReconnecting'
  | 'statusConnected'
  | 'statusDisconnected'
  | 'statusError'
  | 'reconnecting'
  | 'reconnectedOk'
  | 'readyToConnect'
  | 'readyToConnectHint'
  | 'connecting'
  | 'connectingTo'
  | 'connectedOk'
  | 'connectedTo'
  | 'treeTitle'
  | 'treePath'
  | 'treePathHint'
  | 'treePin'
  | 'treeUnpin'
  | 'treeSearch'
  | 'treeSearchEmpty'
  | 'terminalSearch'
  | 'terminalSearchNext'
  | 'terminalSearchPrev'
  | 'terminalSearchClose'
  | 'refresh'
  | 'close'
  | 'treeConnectHint'
  | 'loading'
  | 'empty'
  | 'goTo'
  | 'settingsTitle'
  | 'settingsLanguage'
  | 'settingsTheme'
  | 'themeDark'
  | 'themeLight'
  | 'settingsDone'
  | 'settingsAbout'
  | 'settingsGithub'
  | 'settingsUpdates'
  | 'settingsData'
  | 'settingsDataHint'
  | 'settingsSecretsOk'
  | 'settingsSecretsFallback'
  | 'importSource'
  | 'exportMode'
  | 'importAction'
  | 'exportAction'
  | 'importWinScp'
  | 'importFileZilla'
  | 'importTermius'
  | 'importCustomSsh'
  | 'exportWithPasswords'
  | 'exportWithoutPasswords'
  | 'exportPassphrasePrompt'
  | 'exportPassphraseHint'
  | 'importPassphrasePrompt'
  | 'importPassphraseHint'
  | 'importOk'
  | 'importNone'
  | 'importFailed'
  | 'exportOk'
  | 'exportFailed'
  | 'passphraseContinue'
  | 'passphraseCancel'
  | 'updateCheck'
  | 'updateChecking'
  | 'updateAvailable'
  | 'updateNotAvailable'
  | 'updateDownloading'
  | 'updateReady'
  | 'updateDownload'
  | 'updateInstall'
  | 'updateOpenReleases'
  | 'updateErrorMacUnsigned'
  | 'updateErrorNetwork'
  | 'updateErrorNotFound'
  | 'updateErrorChecksum'
  | 'updateErrorPermission'
  | 'updateErrorGeneric'
  | 'updateDevOnly'
  | 'updatePortable'
  | 'updatePromptTitle'
  | 'updatePromptMessage'
  | 'updatePromptMessageMac'
  | 'updatePromptYes'
  | 'updateLater'
  | 'updatePromptDownloadingTitle'
  | 'updateDownloadBackground'
  | 'updatePromptReadyTitle'
  | 'updatePromptReadyMessage'
  | 'windowClose'
  | 'windowMinimize'
  | 'windowFullscreen'
  | 'windowExitFullscreen'
  | 'errName'
  | 'errHost'
  | 'errUsername'
  | 'errPort'
  | 'errPassword'
  | 'errPrivateKey'
  | 'errConnectFailed'
  | 'errConnectionFailed'
  | 'reconnectSameTitle'
  | 'reconnectSameMessage'
  | 'reconnectSameConfirm'
  | 'newFolderDefault'
  | 'terminalTab'
  | 'terminalNewTab'
  | 'terminalCloseTab'
  | 'terminalRenameTab'

const en: Record<MessageKey, string> = {
  appName: 'Custom SSH',
  connections: 'Connections',
  newFolder: 'New folder',
  newConnection: 'New connection',
  search: 'Search',
  settings: 'Settings',
  hotkeys: 'Hotkeys',
  hotkeysTitle: 'Hotkeys',
  hotkeysHint: 'Click a shortcut, then press the new key combination.',
  hotkeysPress: 'Press keys…',
  hotkeysReset: 'Reset',
  hotkeysConflict: 'Already used by “{action}”',
  hotkeyCopy: 'Copy',
  hotkeyPaste: 'Paste',
  hotkeySelectLine: 'Select current line',
  hotkeyInterrupt: 'Interrupt (SIGINT)',
  hotkeySuspend: 'Suspend process',
  fileEdit: 'Edit file',
  fileDownload: 'Download',
  fileDownloadFolder: 'Download folder',
  fileDownloadSelected: 'Download selected ({count})',
  fileCopyPath: 'Copy path',
  fileCopyPaths: 'Copy paths',
  fileClearSelection: 'Clear selection',
  fileSelectedCount: 'Selected: {count}',
  fileDownloadOk: 'Downloaded',
  fileDownloadManyOk: 'Downloaded {count} files',
  fileDownloadFailed: 'Download failed',
  fileSelectHint: 'Ctrl/Shift + click to select files or folders',
  fileUploadHere: 'Upload here',
  fileUploadOk: 'Uploaded',
  fileUploadManyOk: 'Uploaded {count} files',
  fileUploadFailed: 'Upload failed',
  fileTransferCancel: 'Cancel',
  fileTransferPending: 'Queued',
  fileTransferActive: 'Active',
  fileTransferDone: 'Done',
  fileTransferCancelled: 'Cancelled',
  fileTransferCancelledOk: 'Transfer cancelled',
  fileTransferPartialOk: 'Completed {done}, cancelled {cancelled}',
  fileUploadQueued: 'Added to upload queue ({count})',
  transferDockTitle: 'Transfers',
  transferDockUploading: 'Uploading {count} · {percent}%',
  transferDockDownloading: 'Downloading {count} · {percent}%',
  transferDockMixed: 'Transfers {count} · {percent}%',
  transferDockIdle: 'Transfers complete',
  transferDockClear: 'Clear finished',
  transferDockBatchUpload: 'Upload',
  transferDockBatchDownload: 'Download',
  transferDockCancelledCount: 'cancelled {count}',
  fileNewFolder: 'New folder',
  fileNewFile: 'New file',
  fileFileNamePrompt: 'File name',
  fileRename: 'Rename',
  fileDelete: 'Delete',
  fileDeleteConfirm: 'Delete “{name}”? This cannot be undone.',
  fileDeleteConfirmMany: 'Delete {count} items? This cannot be undone.',
  fileNamePrompt: 'New name',
  fileFolderNamePrompt: 'Folder name',
  fileDropHint: 'Drop onto a folder, or here to upload into the current directory',
  fileDropTarget: 'Upload into {path}',
  fileOpFailed: 'Operation failed',
  fileDeleteOk: 'Deleted',
  cancel: 'Cancel',
  confirm: 'OK',
  editorSave: 'Save',
  editorSaving: 'Saving…',
  editorSaveFailed: 'Failed to save',
  editorLoadFailed: 'Failed to open file',
  editorMissingParams: 'Missing session or file path',
  editorStatusSaved: 'Saved',
  editorStatusUnsaved: 'Unsaved changes',
  editorUnsavedTitle: 'Unsaved changes',
  editorUnsavedMessage: 'The file has unsaved changes.',
  editorUnsavedDetail: 'Save before closing, or discard your edits.',
  editorSaveAndClose: 'Save and close',
  editorDiscard: 'Close without saving',
  editorKeepEditing: 'Cancel',
  editorFind: 'Find',
  editorFindPlaceholder: 'Text to find…',
  editorReplace: 'Replace with',
  editorReplacePlaceholder: 'Replacement text…',
  editorFindNext: 'Next',
  editorFindPrev: 'Previous',
  editorFindAll: 'Select all',
  editorMatchCase: 'Match case',
  editorMatchCaseTip: 'Distinguish uppercase and lowercase letters',
  editorRegexp: 'Regex',
  editorRegexpTip: 'Use a regular expression pattern (e.g. \\d+ for digits)',
  editorByWord: 'Whole word',
  editorByWordTip: 'Match only whole words, not parts inside other words',
  editorReplaceOne: 'Replace',
  editorReplaceAll: 'Replace all',
  editorFindClose: 'Close',
  editorClearField: 'Clear',
  editorGoToLine: 'Go to line',
  editorGo: 'Go',
  noConnections: 'No saved connections yet.',
  noConnectionsHint: 'Create a folder or connection to get started.',
  expand: 'Expand',
  collapse: 'Collapse',
  changeColor: 'Change color',
  rename: 'Rename',
  deleteFolder: 'Delete folder',
  doubleClickRename: 'Double-click to rename',
  emptyFolder: 'Empty folder',
  noFolder: 'No folder',
  noUngrouped: 'No ungrouped connections',
  moveTo: 'Move to',
  editConnection: 'Edit connection',
  newConnectionHeading: 'New connection',
  name: 'Name',
  folder: 'Folder',
  host: 'Host',
  port: 'Port',
  username: 'Username',
  authentication: 'Authentication',
  password: 'Password',
  privateKey: 'Private key',
  authPassword: 'Password',
  authPrivateKey: 'Private key',
  passphrase: 'Passphrase (optional)',
  browse: 'Browse',
  connect: 'Connect',
  save: 'Save',
  delete: 'Delete',
  namePlaceholder: 'Production VPS',
  passwordKeep: 'Leave empty to keep saved password',
  passphraseKeep: 'Leave empty to keep saved',
  untitledConnection: 'Untitled connection',
  configureHost: 'Configure a host to begin',
  directoryTree: 'Directory tree',
  disconnect: 'Disconnect',
  ping: 'Latency',
  pingMeasuring: 'Measuring…',
  statusIdle: 'Idle',
  statusConnecting: 'Connecting',
  statusReconnecting: 'Reconnecting… ({attempt})',
  statusConnected: 'Connected',
  statusDisconnected: 'Disconnected',
  statusError: 'Error',
  reconnecting: 'Connection lost. Reconnecting… ({attempt})',
  reconnectedOk: '✓ Reconnected',
  readyToConnect: 'Ready to connect',
  readyToConnectHint:
    'Choose a saved connection or fill in the form, then press Connect. Your sessions stay in the sidebar for quick relaunch.',
  connecting: 'Connecting…',
  connectingTo: 'Connecting to {target}…',
  connectedOk: '✓ Connected successfully',
  connectedTo: '✓ Connected to {target}',
  treeTitle: 'Directory tree',
  treePath: 'Current path',
  treePathHint: 'Double-click to edit, Enter to go',
  treePin: 'Pin panel',
  treeUnpin: 'Unpin panel',
  treeSearch: 'Filter files…',
  treeSearchEmpty: 'No matching files',
  terminalSearch: 'Find in terminal',
  terminalSearchNext: 'Next',
  terminalSearchPrev: 'Previous',
  terminalSearchClose: 'Close search',
  refresh: 'Refresh',
  close: 'Close',
  treeConnectHint: 'Connect to a host to browse files.',
  loading: 'Loading…',
  empty: 'Empty',
  goTo: 'Go',
  settingsTitle: 'Settings',
  settingsLanguage: 'Language',
  settingsTheme: 'Theme',
  themeDark: 'Dark',
  themeLight: 'Light',
  settingsDone: 'Done',
  settingsAbout: 'About',
  settingsGithub: 'GitHub repository',
  settingsUpdates: 'Updates',
  settingsData: 'Data',
  settingsDataHint:
    'Import hosts from other apps or export a CustomSSH backup. Saved passwords are encrypted on disk.',
  settingsSecretsOk: 'Passwords encrypted with OS secure storage',
  settingsSecretsFallback: 'Passwords encrypted with a device-local key',
  importSource: 'Import from',
  exportMode: 'Export',
  importAction: 'Import',
  exportAction: 'Export',
  importWinScp: 'WinSCP (.ini)',
  importFileZilla: 'FileZilla (.xml)',
  importTermius: 'Termius (.json)',
  importCustomSsh: 'CustomSSH backup',
  exportWithPasswords: 'With passwords (encrypted)',
  exportWithoutPasswords: 'Without passwords',
  exportPassphrasePrompt: 'Backup passphrase',
  exportPassphraseHint: 'Required to open this backup on another device.',
  importPassphrasePrompt: 'Backup passphrase',
  importPassphraseHint: 'Enter the passphrase used when exporting.',
  importOk: 'Imported {count} connection(s), {folders} folder(s).',
  importNone: 'No new connections found (duplicates skipped).',
  importFailed: 'Import failed',
  exportOk: 'Exported to {path}',
  exportFailed: 'Export failed',
  passphraseContinue: 'Continue',
  passphraseCancel: 'Cancel',
  updateCheck: 'Check for updates',
  updateChecking: 'Checking for updates…',
  updateAvailable: 'Update available: v{version}',
  updateNotAvailable: 'You are on the latest version',
  updateDownloading: 'Downloading… {percent}%',
  updateReady: 'Update ready: v{version}',
  updateDownload: 'Download update',
  updateInstall: 'Restart and install',
  updateOpenReleases: 'Open GitHub Releases',
  updateErrorMacUnsigned:
    'In-app update is unavailable on Mac. Download the .dmg from GitHub Releases.',
  updateErrorNetwork: 'No connection to the update server.',
  updateErrorNotFound: 'Update not found. Try later or download from Releases.',
  updateErrorChecksum: 'Update file is damaged. Download manually from Releases.',
  updateErrorPermission: 'Could not save the update. Restart the app and try again.',
  updateErrorGeneric: 'Could not update. Download the latest build from Releases.',
  updateDevOnly: 'Updates work in the installed app build',
  updatePortable: 'Portable build does not support auto-update — use the installer',
  updatePromptTitle: 'Update available',
  updatePromptMessage:
    'A new version of CustomSSH is available. Do you want to download it now?',
  updatePromptMessageMac:
    'A new version is available. Download the .dmg from GitHub Releases and replace the app (Mac builds are unsigned, so in-app install is not supported).',
  updatePromptYes: 'Update',
  updateLater: "I'll update later",
  updatePromptDownloadingTitle: 'Downloading update',
  updateDownloadBackground: 'Continue in background',
  updatePromptReadyTitle: 'Update ready',
  updatePromptReadyMessage:
    'Version {version} has been downloaded. Restart CustomSSH to install it?',
  windowClose: 'Close',
  windowMinimize: 'Minimize',
  windowFullscreen: 'Fullscreen',
  windowExitFullscreen: 'Exit fullscreen',
  errName: 'Name is required',
  errHost: 'Host is required',
  errUsername: 'Username is required',
  errPort: 'Port must be between 1 and 65535',
  errPassword: 'Password is required',
  errPrivateKey: 'Private key path is required',
  errConnectFailed: 'Failed to connect',
  errConnectionFailed: 'Connection failed',
  reconnectSameTitle: 'Same connection',
  reconnectSameMessage:
    'This tab is already connected to {target}. Reconnect anyway?',
  reconnectSameConfirm: 'Reconnect',
  newFolderDefault: 'New folder',
  terminalTab: 'Terminal {n}',
  terminalNewTab: 'New terminal',
  terminalCloseTab: 'Close terminal',
  terminalRenameTab: 'Rename tab (double-click)',
}

const ru: Record<MessageKey, string> = {
  appName: 'Custom SSH',
  connections: 'Подключения',
  newFolder: 'Новая папка',
  newConnection: 'Новое подключение',
  search: 'Поиск',
  settings: 'Настройки',
  hotkeys: 'Горячие клавиши',
  hotkeysTitle: 'Горячие клавиши',
  hotkeysHint: 'Нажмите на сочетание, затем задайте новое.',
  hotkeysPress: 'Нажмите клавиши…',
  hotkeysReset: 'Сброс',
  hotkeysConflict: 'Уже занято действием «{action}»',
  hotkeyCopy: 'Копировать',
  hotkeyPaste: 'Вставить',
  hotkeySelectLine: 'Выделить текущую строку',
  hotkeyInterrupt: 'Прервать (SIGINT)',
  hotkeySuspend: 'Приостановить процесс',
  fileEdit: 'Редактировать',
  fileDownload: 'Скачать',
  fileDownloadFolder: 'Скачать папку',
  fileDownloadSelected: 'Скачать выбранные ({count})',
  fileCopyPath: 'Копировать путь',
  fileCopyPaths: 'Копировать пути',
  fileClearSelection: 'Снять выделение',
  fileSelectedCount: 'Выбрано: {count}',
  fileDownloadOk: 'Скачано',
  fileDownloadManyOk: 'Скачано файлов: {count}',
  fileDownloadFailed: 'Не удалось скачать',
  fileSelectHint: 'Ctrl/Shift + клик — выбрать файлы или папки',
  fileUploadHere: 'Загрузить сюда',
  fileUploadOk: 'Загружено',
  fileUploadManyOk: 'Загружено файлов: {count}',
  fileUploadFailed: 'Не удалось загрузить',
  fileTransferCancel: 'Отменить',
  fileTransferPending: 'В очереди',
  fileTransferActive: 'Идёт',
  fileTransferDone: 'Готово',
  fileTransferCancelled: 'Отменено',
  fileTransferCancelledOk: 'Передача отменена',
  fileTransferPartialOk: 'Готово: {done}, отменено: {cancelled}',
  fileUploadQueued: 'Добавлено в очередь загрузки ({count})',
  transferDockTitle: 'Загрузки',
  transferDockUploading: 'Отправка {count} · {percent}%',
  transferDockDownloading: 'Скачивание {count} · {percent}%',
  transferDockMixed: 'Передачи {count} · {percent}%',
  transferDockIdle: 'Передачи завершены',
  transferDockClear: 'Очистить завершённые',
  transferDockBatchUpload: 'Загрузка',
  transferDockBatchDownload: 'Скачивание',
  transferDockCancelledCount: 'отменено {count}',
  fileNewFolder: 'Новая папка',
  fileNewFile: 'Создать файл',
  fileFileNamePrompt: 'Имя файла',
  fileRename: 'Переименовать',
  fileDelete: 'Удалить',
  fileDeleteConfirm: 'Удалить «{name}»? Это действие нельзя отменить.',
  fileDeleteConfirmMany: 'Удалить элементов: {count}? Это действие нельзя отменить.',
  fileNamePrompt: 'Новое имя',
  fileFolderNamePrompt: 'Имя папки',
  fileDropHint:
    'Перетащите на папку или сюда — загрузка в текущую директорию',
  fileDropTarget: 'Загрузить в {path}',
  fileOpFailed: 'Операция не удалась',
  fileDeleteOk: 'Удалено',
  cancel: 'Отмена',
  confirm: 'ОК',
  editorSave: 'Сохранить',
  editorSaving: 'Сохранение…',
  editorSaveFailed: 'Не удалось сохранить',
  editorLoadFailed: 'Не удалось открыть файл',
  editorMissingParams: 'Нет сессии или пути к файлу',
  editorStatusSaved: 'Сохранено',
  editorStatusUnsaved: 'Есть несохранённые изменения',
  editorUnsavedTitle: 'Несохранённые изменения',
  editorUnsavedMessage: 'В файле есть несохранённые изменения.',
  editorUnsavedDetail: 'Сохранить перед закрытием или отменить правки.',
  editorSaveAndClose: 'Сохранить и закрыть',
  editorDiscard: 'Закрыть без сохранения',
  editorKeepEditing: 'Отмена',
  editorFind: 'Найти',
  editorFindPlaceholder: 'Что искать…',
  editorReplace: 'Заменить на',
  editorReplacePlaceholder: 'На что заменить…',
  editorFindNext: 'Далее',
  editorFindPrev: 'Назад',
  editorFindAll: 'Выделить все',
  editorMatchCase: 'Учёт регистра',
  editorMatchCaseTip: 'Различать заглавные и строчные буквы',
  editorRegexp: 'Рег. выражение',
  editorRegexpTip: 'Искать по шаблону (например, \\d+ — цифры)',
  editorByWord: 'Слово целиком',
  editorByWordTip: 'Искать только целые слова, а не фрагменты внутри других',
  editorReplaceOne: 'Заменить',
  editorReplaceAll: 'Заменить все',
  editorFindClose: 'Закрыть',
  editorClearField: 'Очистить',
  editorGoToLine: 'Перейти к строке',
  editorGo: 'Перейти',
  noConnections: 'Пока нет сохранённых подключений.',
  noConnectionsHint: 'Создайте папку или подключение, чтобы начать.',
  expand: 'Развернуть',
  collapse: 'Свернуть',
  changeColor: 'Изменить цвет',
  rename: 'Переименовать',
  deleteFolder: 'Удалить папку',
  doubleClickRename: 'Двойной клик — переименовать',
  emptyFolder: 'Пустая папка',
  noFolder: 'Без папки',
  noUngrouped: 'Нет подключений вне папок',
  moveTo: 'Переместить в',
  editConnection: 'Редактирование',
  newConnectionHeading: 'Новое подключение',
  name: 'Имя',
  folder: 'Папка',
  host: 'Хост',
  port: 'Порт',
  username: 'Пользователь',
  authentication: 'Аутентификация',
  password: 'Пароль',
  privateKey: 'Приватный ключ',
  authPassword: 'Пароль',
  authPrivateKey: 'Приватный ключ',
  passphrase: 'Парольная фраза (необязательно)',
  browse: 'Обзор',
  connect: 'Подключиться',
  save: 'Сохранить',
  delete: 'Удалить',
  namePlaceholder: 'Production VPS',
  passwordKeep: 'Оставьте пустым, чтобы сохранить текущий пароль',
  passphraseKeep: 'Оставьте пустым, чтобы сохранить текущую',
  untitledConnection: 'Без названия',
  configureHost: 'Укажите хост, чтобы начать',
  directoryTree: 'Дерево каталогов',
  disconnect: 'Отключить',
  ping: 'Пинг',
  pingMeasuring: 'Измерение…',
  statusIdle: 'Ожидание',
  statusConnecting: 'Подключение',
  statusReconnecting: 'Переподключение… ({attempt})',
  statusConnected: 'Подключено',
  statusDisconnected: 'Отключено',
  statusError: 'Ошибка',
  reconnecting: 'Связь потеряна. Переподключение… ({attempt})',
  reconnectedOk: '✓ Переподключено',
  readyToConnect: 'Готово к подключению',
  readyToConnectHint:
    'Выберите сохранённое подключение или заполните форму и нажмите «Подключиться». Сессии остаются в боковой панели для быстрого запуска.',
  connecting: 'Подключение…',
  connectingTo: 'Подключение к {target}…',
  connectedOk: '✓ Успешно подключено',
  connectedTo: '✓ Подключено к {target}',
  treeTitle: 'Дерево каталогов',
  treePath: 'Текущий путь',
  treePathHint: 'Двойной клик — изменить, Enter — перейти',
  treePin: 'Закрепить панель',
  treeUnpin: 'Открепить панель',
  treeSearch: 'Фильтр файлов…',
  treeSearchEmpty: 'Ничего не найдено',
  terminalSearch: 'Поиск в терминале',
  terminalSearchNext: 'Далее',
  terminalSearchPrev: 'Назад',
  terminalSearchClose: 'Закрыть поиск',
  refresh: 'Обновить',
  close: 'Закрыть',
  treeConnectHint: 'Подключитесь к хосту, чтобы просматривать файлы.',
  loading: 'Загрузка…',
  empty: 'Пусто',
  goTo: 'Перейти',
  settingsTitle: 'Настройки',
  settingsLanguage: 'Язык',
  settingsTheme: 'Тема',
  themeDark: 'Тёмная',
  themeLight: 'Светлая',
  settingsDone: 'Готово',
  settingsAbout: 'О приложении',
  settingsGithub: 'Репозиторий на GitHub',
  settingsUpdates: 'Обновления',
  settingsData: 'Данные',
  settingsDataHint:
    'Импорт хостов из других программ или экспорт резервной копии CustomSSH. Пароли на диске хранятся в зашифрованном виде.',
  settingsSecretsOk: 'Пароли шифруются через защищённое хранилище ОС',
  settingsSecretsFallback: 'Пароли шифруются локальным ключом устройства',
  importSource: 'Импорт из',
  exportMode: 'Экспорт',
  importAction: 'Импорт',
  exportAction: 'Экспорт',
  importWinScp: 'WinSCP (.ini)',
  importFileZilla: 'FileZilla (.xml)',
  importTermius: 'Termius (.json)',
  importCustomSsh: 'Копия CustomSSH',
  exportWithPasswords: 'С паролями (шифрованный)',
  exportWithoutPasswords: 'Без паролей',
  exportPassphrasePrompt: 'Пароль резервной копии',
  exportPassphraseHint: 'Нужен, чтобы открыть копию на другом устройстве.',
  importPassphrasePrompt: 'Пароль резервной копии',
  importPassphraseHint: 'Введите пароль, заданный при экспорте.',
  importOk: 'Импортировано подключений: {count}, папок: {folders}.',
  importNone: 'Новых подключений нет (дубликаты пропущены).',
  importFailed: 'Ошибка импорта',
  exportOk: 'Экспортировано в {path}',
  exportFailed: 'Ошибка экспорта',
  passphraseContinue: 'Продолжить',
  passphraseCancel: 'Отмена',
  updateCheck: 'Проверить обновления',
  updateChecking: 'Проверка обновлений…',
  updateAvailable: 'Доступно обновление: v{version}',
  updateNotAvailable: 'У вас последняя версия',
  updateDownloading: 'Загрузка… {percent}%',
  updateReady: 'Обновление готово: v{version}',
  updateDownload: 'Скачать обновление',
  updateInstall: 'Перезапустить и установить',
  updateOpenReleases: 'Открыть GitHub Releases',
  updateErrorMacUnsigned:
    'Автообновление на Mac недоступно. Скачайте .dmg со страницы Releases.',
  updateErrorNetwork: 'Нет связи с сервером обновлений.',
  updateErrorNotFound: 'Обновление не найдено. Попробуйте позже или скачайте с Releases.',
  updateErrorChecksum: 'Файл обновления повреждён. Скачайте вручную с Releases.',
  updateErrorPermission: 'Не удалось сохранить обновление. Перезапустите приложение.',
  updateErrorGeneric: 'Не удалось обновить. Скачайте последнюю версию с Releases.',
  updateDevOnly: 'Автообновление работает в установленной сборке',
  updatePortable: 'Portable-сборка не обновляется автоматически — используйте установщик',
  updatePromptTitle: 'Доступно обновление',
  updatePromptMessage:
    'Доступна новая версия CustomSSH. Скачать обновление сейчас?',
  updatePromptMessageMac:
    'Доступна новая версия. Скачайте .dmg со страницы GitHub Releases и замените приложение (на Mac автоустановка недоступна — сборка без подписи Apple).',
  updatePromptYes: 'Обновить',
  updateLater: 'Обновлюсь позже',
  updatePromptDownloadingTitle: 'Загрузка обновления',
  updateDownloadBackground: 'Продолжить в фоне',
  updatePromptReadyTitle: 'Обновление готово',
  updatePromptReadyMessage:
    'Версия {version} скачана. Перезапустить CustomSSH для установки?',
  windowClose: 'Закрыть',
  windowMinimize: 'Свернуть',
  windowFullscreen: 'На весь экран',
  windowExitFullscreen: 'Выйти из полноэкранного режима',
  errName: 'Укажите имя',
  errHost: 'Укажите хост',
  errUsername: 'Укажите пользователя',
  errPort: 'Порт должен быть от 1 до 65535',
  errPassword: 'Укажите пароль',
  errPrivateKey: 'Укажите путь к приватному ключу',
  errConnectFailed: 'Не удалось подключиться',
  errConnectionFailed: 'Ошибка подключения',
  reconnectSameTitle: 'То же подключение',
  reconnectSameMessage:
    'Эта вкладка уже подключена к {target}. Переподключиться всё равно?',
  reconnectSameConfirm: 'Переподключить',
  newFolderDefault: 'Новая папка',
  terminalTab: 'Терминал {n}',
  terminalNewTab: 'Новый терминал',
  terminalCloseTab: 'Закрыть терминал',
  terminalRenameTab: 'Переименовать вкладку (двойной клик)',
}

const catalogs: Record<AppLocale, Record<MessageKey, string>> = { en, ru }

export function translate(locale: AppLocale, key: MessageKey): string {
  return catalogs[locale][key] ?? catalogs.en[key] ?? key
}
