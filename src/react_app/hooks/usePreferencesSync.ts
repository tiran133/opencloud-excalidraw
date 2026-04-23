import { useRef, useState } from 'react'
import { pickPreferencesState, prefsEqual } from '../preferencesState'
import type { PreferencesState } from '../preferencesState'
import type { AppState } from '@excalidraw/excalidraw/types'

export function usePreferencesSync(readOnly: boolean) {
  const [prefsState, setPrefsState] = useState<PreferencesState>({
    activeTool_locked: false,
    objectsSnapModeEnabled: false,
    gridModeEnabled: false,
    zenModeEnabled: false,
    viewModeEnabled: readOnly,
    statsOpen: false,
    theme: 'light'
  })
  const prefsStateRef = useRef<PreferencesState>(prefsState)

  function syncPreferences(appState: AppState) {
    const newPrefs = pickPreferencesState(appState)
    if (!prefsEqual(newPrefs, prefsStateRef.current)) {
      prefsStateRef.current = newPrefs
      setPrefsState(newPrefs)
    }
  }

  return { prefsState, syncPreferences }
}
