/**
 * Pure helper types and functions for tracking Excalidraw preferences.
 * Extracted from PreferencesMenu so they can be unit-tested without
 * pulling in the full @excalidraw/excalidraw library.
 */
import { AppState } from '@excalidraw/excalidraw/types'

export interface PreferencesState {
  activeTool_locked: boolean
  objectsSnapModeEnabled: boolean
  gridModeEnabled: boolean
  zenModeEnabled: boolean
  viewModeEnabled: boolean
  statsOpen: boolean
  theme: string
}

/**
 * Pick the relevant preference fields from an Excalidraw AppState object.
 * Accepts `any` so this module has zero Excalidraw type dependencies.
 */
export function pickPreferencesState(appState: AppState): PreferencesState {
  return {
    activeTool_locked: appState.activeTool?.locked ?? false,
    objectsSnapModeEnabled: appState.objectsSnapModeEnabled,
    gridModeEnabled: appState.gridModeEnabled,
    zenModeEnabled: appState.zenModeEnabled,
    viewModeEnabled: appState.viewModeEnabled,
    statsOpen: appState.stats?.open ?? false,
    theme: appState.theme || 'light'
  }
}

export function prefsEqual(a: PreferencesState, b: PreferencesState): boolean {
  return (
    a.activeTool_locked === b.activeTool_locked &&
    a.objectsSnapModeEnabled === b.objectsSnapModeEnabled &&
    a.gridModeEnabled === b.gridModeEnabled &&
    a.zenModeEnabled === b.zenModeEnabled &&
    a.viewModeEnabled === b.viewModeEnabled &&
    a.statsOpen === b.statsOpen &&
    a.theme === b.theme
  )
}
