import type { AppLocale } from '../types'
import type { MessageKey } from './messageKeys'
import { ru } from './messages/ru'

export type { MessageKey } from './messageKeys'

const catalogs: Partial<Record<AppLocale, Record<MessageKey, string>>> = {
  ru,
}

let enPromise: Promise<Record<MessageKey, string>> | null = null

export async function ensureLocale(locale: AppLocale): Promise<void> {
  if (locale === 'ru' || catalogs[locale]) return
  if (locale === 'en') {
    if (!enPromise) {
      enPromise = import('./messages/en').then((mod) => {
        catalogs.en = mod.en
        return mod.en
      })
    }
    await enPromise
  }
}

export function translate(locale: AppLocale, key: MessageKey): string {
  const cat = catalogs[locale] ?? catalogs.ru
  return cat?.[key] ?? catalogs.ru?.[key] ?? key
}
