import { computed } from 'vue'
import { useUserStore } from '@opencloud-eu/web-pkg'
import { excalidrawLocaleMap } from '../helpers/excalidrawLocaleMap'

export function useEditorLocale() {
  const userStore = useUserStore()

  const langCode = computed(() => {
    const lang = userStore.user?.preferredLanguage || navigator.language || 'en'
    // If the code already matches an Excalidraw locale (e.g. "de-DE"), use it directly
    if (lang.includes('-')) return lang
    // Otherwise map from short code to Excalidraw locale
    return excalidrawLocaleMap[lang] || 'en'
  })

  return { langCode }
}
