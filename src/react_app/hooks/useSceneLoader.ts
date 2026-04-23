import { useEffect, useRef } from 'react'
import { loadFromBlob, THEME, FONT_FAMILY } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

export function useSceneLoader(
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  apiReady: boolean,
  initialData: string | undefined,
  readOnly: boolean,
  isDarkTheme: boolean,
  resetVersionRefs?: () => void
) {
  const loadedDataRef = useRef<string | null>(null)
  const isInternalChange = useRef(false)

  useEffect(() => {
    if (!apiReady || !initialData || !excalidrawAPI) return
    if (loadedDataRef.current === initialData) return
    if (isInternalChange.current) {
      isInternalChange.current = false
      return
    }

    loadedDataRef.current = initialData

    try {
      const blob = new Blob([initialData], { type: 'application/json' })
      loadFromBlob(blob, null, null)
        .then((data) => {
          if (data && excalidrawAPI) {
            console.log('Loaded Excalidraw data:', data)
            excalidrawAPI.updateScene({
              elements: data.elements,
              appState: {
                ...data.appState,
                currentItemRoundness: 'sharp',
                currentItemFontFamily: FONT_FAMILY.Nunito,
                currentItemRoughness: 0,
                viewModeEnabled: readOnly,
                theme: isDarkTheme ? THEME.DARK : THEME.LIGHT
              }
            })
            if (data.files) {
              excalidrawAPI.addFiles(Object.values(data.files))
            }
            // Re-seed version refs so the loaded content isn't treated as a user edit
            resetVersionRefs?.()
          }
        })
        .catch((e) => {
          console.error('Failed to load Excalidraw data from blob:', e)
        })
    } catch (e) {
      console.error('Failed to load Excalidraw data:', e)
    }
  }, [initialData, apiReady, readOnly, isDarkTheme, excalidrawAPI, resetVersionRefs])

  return { isInternalChange }
}
