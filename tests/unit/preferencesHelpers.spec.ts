import { describe, expect, it } from 'vitest'
import { pickPreferencesState, prefsEqual } from '../../src/react_app/preferencesState'
import type { PreferencesState } from '../../src/react_app/preferencesState'

describe('pickPreferencesState', () => {
  const baseAppState = {
    activeTool: { locked: true },
    objectsSnapModeEnabled: false,
    gridModeEnabled: true,
    zenModeEnabled: false,
    viewModeEnabled: false,
    stats: { open: true },
    theme: 'dark'
  }

  it('extracts all preference fields from AppState', () => {
    const result = pickPreferencesState(baseAppState)
    expect(result).toEqual({
      activeTool_locked: true,
      objectsSnapModeEnabled: false,
      gridModeEnabled: true,
      zenModeEnabled: false,
      viewModeEnabled: false,
      statsOpen: true,
      theme: 'dark'
    })
  })

  it('defaults activeTool.locked to false when activeTool is missing', () => {
    const state = { ...baseAppState, activeTool: undefined }
    const result = pickPreferencesState(state)
    expect(result.activeTool_locked).toBe(false)
  })

  it('defaults stats.open to false when stats is missing', () => {
    const state = { ...baseAppState, stats: undefined }
    const result = pickPreferencesState(state)
    expect(result.statsOpen).toBe(false)
  })

  it('defaults theme to "light" when theme is empty', () => {
    const state = { ...baseAppState, theme: '' }
    const result = pickPreferencesState(state)
    expect(result.theme).toBe('light')
  })
})

describe('prefsEqual', () => {
  const prefs: PreferencesState = {
    activeTool_locked: false,
    objectsSnapModeEnabled: false,
    gridModeEnabled: false,
    zenModeEnabled: false,
    viewModeEnabled: false,
    statsOpen: false,
    theme: 'light'
  }

  it('returns true for identical objects', () => {
    expect(prefsEqual(prefs, { ...prefs })).toBe(true)
  })

  it('returns false when any single field differs', () => {
    expect(prefsEqual(prefs, { ...prefs, activeTool_locked: true })).toBe(false)
    expect(prefsEqual(prefs, { ...prefs, objectsSnapModeEnabled: true })).toBe(false)
    expect(prefsEqual(prefs, { ...prefs, gridModeEnabled: true })).toBe(false)
    expect(prefsEqual(prefs, { ...prefs, zenModeEnabled: true })).toBe(false)
    expect(prefsEqual(prefs, { ...prefs, viewModeEnabled: true })).toBe(false)
    expect(prefsEqual(prefs, { ...prefs, statsOpen: true })).toBe(false)
    expect(prefsEqual(prefs, { ...prefs, theme: 'dark' })).toBe(false)
  })
})
