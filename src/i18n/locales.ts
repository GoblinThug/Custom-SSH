import type { AppLocale } from '../types'

/** Native language names (stable in the dropdown regardless of UI locale). */
export const APP_LOCALES: ReadonlyArray<{ id: AppLocale; label: string }> = [
  { id: 'ru', label: 'Русский' },
  { id: 'en', label: 'English' },
]
