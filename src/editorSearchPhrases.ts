import type { MessageKey } from './i18n/messages'

/** CodeMirror search/goto phrase map for EditorState.phrases */
export function editorSearchPhrases(
  t: (key: MessageKey) => string,
): Record<string, string> {
  return {
    Find: t('editorFind'),
    Replace: t('editorReplace'),
    next: t('editorFindNext'),
    previous: t('editorFindPrev'),
    all: t('editorFindAll'),
    'match case': t('editorMatchCase'),
    regexp: t('editorRegexp'),
    'by word': t('editorByWord'),
    replace: t('editorReplaceOne'),
    'replace all': t('editorReplaceAll'),
    close: t('editorFindClose'),
    'Go to line': t('editorGoToLine'),
    go: t('editorGo'),
  }
}
