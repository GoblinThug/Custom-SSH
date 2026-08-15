import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  selectMatches,
  setSearchQuery,
} from '@codemirror/search'
import type { EditorView, Panel } from '@codemirror/view'
import { runScopeHandlers } from '@codemirror/view'
import type { MessageKey } from './i18n/messages'

type Translate = (key: MessageKey) => string

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue
    if (value === true) node.setAttribute(key, '')
    else node.setAttribute(key, value)
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

function clearIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '12')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M6 6l12 12M18 6L6 18')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '2.2')
  path.setAttribute('stroke-linecap', 'round')
  svg.append(path)
  return svg
}

function btn(name: string, label: string, onClick: () => void): HTMLButtonElement {
  const node = el(
    'button',
    {
      type: 'button',
      class: 'editor-search__btn',
      name,
      title: label,
      'aria-label': label,
    },
    [label],
  )
  node.addEventListener('click', (event) => {
    event.preventDefault()
    onClick()
  })
  return node
}

function syncClear(field: HTMLInputElement, clearBtn: HTMLButtonElement) {
  const empty = field.value.length === 0
  clearBtn.hidden = empty
  clearBtn.tabIndex = empty ? -1 : 0
  field.classList.toggle('has-value', !empty)
}

/** Clear two-row find/replace panel for CodeMirror search(). */
export function createEditorSearchPanel(t: Translate) {
  return (view: EditorView): Panel => {
    let current = getSearchQuery(view.state)

    const searchField = el('input', {
      type: 'text',
      class: 'editor-search__input',
      name: 'search',
      form: '',
      'main-field': 'true',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: t('editorFindPlaceholder'),
      'aria-label': t('editorFind'),
    }) as HTMLInputElement
    searchField.value = current.search

    const replaceField = el('input', {
      type: 'text',
      class: 'editor-search__input',
      name: 'replace',
      form: '',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: t('editorReplacePlaceholder'),
      'aria-label': t('editorReplace'),
    }) as HTMLInputElement
    replaceField.value = current.replace

    const caseField = el('input', {
      type: 'checkbox',
      name: 'case',
      form: '',
    }) as HTMLInputElement
    caseField.checked = current.caseSensitive

    const reField = el('input', {
      type: 'checkbox',
      name: 're',
      form: '',
    }) as HTMLInputElement
    reField.checked = current.regexp

    const wordField = el('input', {
      type: 'checkbox',
      name: 'word',
      form: '',
    }) as HTMLInputElement
    wordField.checked = current.wholeWord

    const commit = () => {
      const next = new SearchQuery({
        search: searchField.value,
        caseSensitive: caseField.checked,
        regexp: reField.checked,
        wholeWord: wordField.checked,
        replace: replaceField.value,
      })
      if (!next.eq(current)) {
        current = next
        view.dispatch({ effects: setSearchQuery.of(next) })
      }
      syncClear(searchField, searchClear)
      syncClear(replaceField, replaceClear)
    }

    const makeClear = (field: HTMLInputElement) => {
      const clearBtn = el(
        'button',
        {
          type: 'button',
          class: 'editor-search__clear',
          title: t('editorClearField'),
          'aria-label': t('editorClearField'),
        },
        [clearIcon()],
      ) as HTMLButtonElement
      clearBtn.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        field.value = ''
        commit()
        field.focus()
      })
      syncClear(field, clearBtn)
      return clearBtn
    }

    const searchClear = makeClear(searchField)
    const replaceClear = makeClear(replaceField)

    const wrapField = (field: HTMLInputElement, clearBtn: HTMLButtonElement) =>
      el('div', { class: 'editor-search__field' }, [field, clearBtn])

    for (const field of [searchField, replaceField]) {
      field.addEventListener('input', commit)
      field.addEventListener('change', commit)
      field.addEventListener('keyup', commit)
    }
    for (const field of [caseField, reField, wordField]) {
      field.addEventListener('change', commit)
    }

    const opt = (
      field: HTMLInputElement,
      short: string,
      label: string,
      tip: string,
    ) =>
      el('label', { class: 'editor-search__opt', title: `${label} — ${tip}` }, [
        field,
        el('span', { class: 'editor-search__opt-short', 'aria-hidden': 'true' }, [
          short,
        ]),
        el('span', { class: 'editor-search__opt-label' }, [label]),
      ])

    const close = el(
      'button',
      {
        type: 'button',
        class: 'editor-search__close',
        name: 'close',
        title: t('editorFindClose'),
        'aria-label': t('editorFindClose'),
      },
      ['×'],
    )
    close.addEventListener('click', (event) => {
      event.preventDefault()
      closeSearchPanel(view)
    })

    const children: Node[] = [
      close,
      el('div', { class: 'editor-search__row' }, [
        el('span', { class: 'editor-search__label' }, [t('editorFind')]),
        wrapField(searchField, searchClear),
        btn('prev', t('editorFindPrev'), () => findPrevious(view)),
        btn('next', t('editorFindNext'), () => findNext(view)),
        btn('select', t('editorFindAll'), () => selectMatches(view)),
        el('div', { class: 'editor-search__opts' }, [
          opt(caseField, 'Aa', t('editorMatchCase'), t('editorMatchCaseTip')),
          opt(reField, '.*', t('editorRegexp'), t('editorRegexpTip')),
          opt(wordField, 'W', t('editorByWord'), t('editorByWordTip')),
        ]),
      ]),
    ]

    if (!view.state.readOnly) {
      children.push(
        el('div', { class: 'editor-search__row' }, [
          el('span', { class: 'editor-search__label' }, [t('editorReplace')]),
          wrapField(replaceField, replaceClear),
          btn('replace', t('editorReplaceOne'), () => replaceNext(view)),
          btn('replaceAll', t('editorReplaceAll'), () => replaceAll(view)),
        ]),
      )
    }

    const dom = el(
      'div',
      { class: 'cm-search editor-search', role: 'search' },
      children,
    )

    dom.addEventListener('keydown', (event) => {
      if (runScopeHandlers(view, event, 'search-panel')) {
        event.preventDefault()
        return
      }
      if (event.key === 'Enter' && event.target === searchField) {
        event.preventDefault()
        ;(event.shiftKey ? findPrevious : findNext)(view)
      } else if (event.key === 'Enter' && event.target === replaceField) {
        event.preventDefault()
        replaceNext(view)
      }
    })

    return {
      dom,
      top: true,
      mount() {
        searchField.select()
      },
      update(update) {
        for (const tr of update.transactions) {
          for (const effect of tr.effects) {
            if (effect.is(setSearchQuery) && !effect.value.eq(current)) {
              current = effect.value
              searchField.value = current.search
              replaceField.value = current.replace
              caseField.checked = current.caseSensitive
              reField.checked = current.regexp
              wordField.checked = current.wholeWord
              syncClear(searchField, searchClear)
              syncClear(replaceField, replaceClear)
            }
          }
        }
      },
    }
  }
}
