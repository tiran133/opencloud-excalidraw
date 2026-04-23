import translations from '../../l10n/translations.json'

type ExtensionLocale = keyof typeof translations
type ExtensionMessages = (typeof translations)[ExtensionLocale]

const localeFallbacks = (langCode?: string): string[] => {
  if (!langCode) {
    return []
  }

  const normalized = langCode.trim()
  if (!normalized) {
    return []
  }

  const shortCode = normalized.split('-')[0]

  return shortCode === normalized ? [normalized] : [normalized, shortCode]
}

export function translateExtensionLabel(langCode: string | undefined, label: string): string {
  for (const locale of localeFallbacks(langCode)) {
    const messages = translations[locale as ExtensionLocale]
    const translated = messages?.[label as keyof ExtensionMessages]

    if (typeof translated === 'string' && translated.length > 0) {
      return translated
    }
  }

  return label
}
