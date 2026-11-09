import type { AppLocale } from '../types'
import type { MessageKey } from './messageKeys'
import { en } from './messages/en'

export type { MessageKey } from './messageKeys'

const catalogs: Partial<Record<AppLocale, Record<MessageKey, string>>> = {
  en,
}

let ruPromise: Promise<Record<MessageKey, string>> | null = null

export async function ensureLocale(locale: AppLocale): Promise<void> {
  if (locale === 'en' || catalogs[locale]) return
  if (locale === 'ru') {
    if (!ruPromise) {
      ruPromise = import('./messages/ru').then((mod) => {
        catalogs.ru = mod.ru
        return mod.ru
      })
    }
    await ruPromise
  }
}

export function translate(locale: AppLocale, key: MessageKey): string {
  const cat = catalogs[locale] ?? catalogs.en
  return cat?.[key] ?? catalogs.en?.[key] ?? key
}
