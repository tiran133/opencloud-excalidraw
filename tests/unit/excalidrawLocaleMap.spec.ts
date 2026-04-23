import { describe, expect, it } from 'vitest'
import { excalidrawLocaleMap } from '../../src/helpers/excalidrawLocaleMap'

describe('excalidrawLocaleMap', () => {
  it('maps short language codes to Excalidraw locale codes', () => {
    expect(excalidrawLocaleMap['de']).toBe('de-DE')
    expect(excalidrawLocaleMap['fr']).toBe('fr-FR')
    expect(excalidrawLocaleMap['ja']).toBe('ja-JP')
    expect(excalidrawLocaleMap['zh']).toBe('zh-CN')
  })

  it('maps "en" to plain "en" (no region suffix)', () => {
    expect(excalidrawLocaleMap['en']).toBe('en')
  })

  it('maps Norwegian "no" to "nb-NO"', () => {
    expect(excalidrawLocaleMap['no']).toBe('nb-NO')
  })

  it('does not contain Serbian (sr) since Excalidraw lacks support', () => {
    expect(excalidrawLocaleMap['sr']).toBeUndefined()
  })

  it('returns undefined for unmapped languages', () => {
    expect(excalidrawLocaleMap['xx']).toBeUndefined()
    expect(excalidrawLocaleMap['']).toBeUndefined()
  })

  it('contains all expected entries', () => {
    const keys = Object.keys(excalidrawLocaleMap)
    expect(keys.length).toBeGreaterThanOrEqual(30)
    // Spot-check a few more
    expect(excalidrawLocaleMap['ar']).toBe('ar-SA')
    expect(excalidrawLocaleMap['ko']).toBe('ko-KR')
    expect(excalidrawLocaleMap['pt']).toBe('pt-PT')
  })
})
