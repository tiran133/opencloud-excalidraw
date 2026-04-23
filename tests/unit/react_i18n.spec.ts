import { describe, expect, it } from 'vitest'
import { translateExtensionLabel } from '../../src/react_app/i18n'

describe('translateExtensionLabel', () => {
  it('uses extension-local translations for matching short locale codes', () => {
    expect(translateExtensionLabel('de', 'Preferences')).toBe('Einstellungen')
    expect(translateExtensionLabel('fr', 'Preferences')).toBe('Préférences')
  })

  it('falls back to the original English label when no translation is available', () => {
    expect(translateExtensionLabel('en', 'Preferences')).toBe('Preferences')
    expect(translateExtensionLabel(undefined, 'Preferences')).toBe('Preferences')
  })

  it('falls back from region code to short code (e.g. de-DE -> de)', () => {
    // de-DE is not a direct key, but "de" is — should fall back to "de"
    expect(translateExtensionLabel('de-DE', 'Preferences')).toBe('Einstellungen')
    expect(translateExtensionLabel('de-AT', 'Preferences')).toBe('Einstellungen')
    expect(translateExtensionLabel('fr-FR', 'Preferences')).toBe('Préférences')
  })

  it('returns the original label for a completely unknown locale', () => {
    expect(translateExtensionLabel('xx-YY', 'Preferences')).toBe('Preferences')
  })

  it('returns the original label for an unknown key', () => {
    expect(translateExtensionLabel('de', 'NonExistentKey')).toBe('NonExistentKey')
  })

  it('handles empty string langCode', () => {
    expect(translateExtensionLabel('', 'Preferences')).toBe('Preferences')
  })

  it('handles whitespace-only langCode', () => {
    expect(translateExtensionLabel('   ', 'Preferences')).toBe('Preferences')
  })

  it('translates all known extension labels for a supported locale', () => {
    // Verify the main extension labels exist in German
    expect(translateExtensionLabel('de', 'Preferences')).toBe('Einstellungen')
    expect(translateExtensionLabel('de', 'View Only')).toBe('Nur Ansicht')
    expect(translateExtensionLabel('de', 'Guest')).toBe('Gast')
    expect(translateExtensionLabel('de', 'Join')).toBe('Beitreten')
  })

  it('uses the exact regional locale when available (short code = direct hit)', () => {
    // "de" short code should directly match the "de" key in translations
    expect(translateExtensionLabel('de', 'Preferences')).toBe('Einstellungen')
  })
})
