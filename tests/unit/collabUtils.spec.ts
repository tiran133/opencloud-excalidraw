import { describe, expect, it } from 'vitest'
import {
  hashToInteger,
  getClientColor,
  escapeSvg,
  generateInitialsAvatarUrl
} from '../../src/react_app/collabUtils'

describe('hashToInteger', () => {
  it('returns a non-negative integer for any string', () => {
    expect(hashToInteger('abc')).toBeGreaterThanOrEqual(0)
    expect(hashToInteger('')).toBe(0)
    expect(Number.isInteger(hashToInteger('test-socket-id'))).toBe(true)
  })

  it('is deterministic — same input always produces same output', () => {
    const id = 'socket-123-xyz'
    expect(hashToInteger(id)).toBe(hashToInteger(id))
  })

  it('produces different hashes for different inputs', () => {
    expect(hashToInteger('a')).not.toBe(hashToInteger('b'))
  })
})

describe('getClientColor', () => {
  it('returns a valid HSL color string', () => {
    const color = getClientColor('socket-abc')
    expect(color).toMatch(/^hsl\(\d+, 100%, 83%\)$/)
  })

  it('hue is in range 0–360', () => {
    const match = getClientColor('test').match(/hsl\((\d+),/)
    const hue = Number(match![1])
    expect(hue).toBeGreaterThanOrEqual(0)
    expect(hue).toBeLessThan(370)
  })

  it('is deterministic', () => {
    expect(getClientColor('xyz')).toBe(getClientColor('xyz'))
  })
})

describe('escapeSvg', () => {
  it('escapes HTML special characters', () => {
    expect(escapeSvg('<script>')).toBe('&lt;script&gt;')
    expect(escapeSvg('"hello"')).toBe('&quot;hello&quot;')
    expect(escapeSvg("it's")).toBe('it&#39;s')
    expect(escapeSvg('a&b')).toBe('a&amp;b')
  })

  it('returns plain text unchanged', () => {
    expect(escapeSvg('AB')).toBe('AB')
  })
})

describe('generateInitialsAvatarUrl', () => {
  it('returns a data URI with base64 SVG', () => {
    const url = generateInitialsAvatarUrl('John Doe', 'socket-1', false)
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('extracts two-letter initials from first and last name', () => {
    const url = generateInitialsAvatarUrl('John Doe', 'socket-1', false)
    const svg = atob(url.replace('data:image/svg+xml;base64,', ''))
    expect(svg).toContain('JD')
  })

  it('extracts single initial for single-word name', () => {
    const url = generateInitialsAvatarUrl('Alice', 'socket-2', false)
    const svg = atob(url.replace('data:image/svg+xml;base64,', ''))
    expect(svg).toContain('>A<')
  })

  it('strips trailing parenthetical suffixes before extracting initials', () => {
    const url = generateInitialsAvatarUrl('Bob Smith (Guest)', 'socket-3', false)
    const svg = atob(url.replace('data:image/svg+xml;base64,', ''))
    expect(svg).toContain('BS')
    expect(svg).not.toContain('BG')
  })

  it('adds a red circle stroke for read-only users', () => {
    const url = generateInitialsAvatarUrl('Reader', 'socket-4', true)
    const svg = atob(url.replace('data:image/svg+xml;base64,', ''))
    expect(svg).toContain('stroke="red"')
  })

  it('omits the red circle for writable users', () => {
    const url = generateInitialsAvatarUrl('Writer', 'socket-5', false)
    const svg = atob(url.replace('data:image/svg+xml;base64,', ''))
    expect(svg).not.toContain('stroke="red"')
  })

  it('uses "?" for an empty name', () => {
    const url = generateInitialsAvatarUrl('', 'socket-6', false)
    const svg = atob(url.replace('data:image/svg+xml;base64,', ''))
    expect(svg).toContain('?')
  })

  it('uses smaller font size for two-letter initials', () => {
    const url = generateInitialsAvatarUrl('John Doe', 'socket-1', false)
    const svg = atob(url.replace('data:image/svg+xml;base64,', ''))
    expect(svg).toContain('font-size="12"')
  })

  it('uses larger font size for single-letter initials', () => {
    const url = generateInitialsAvatarUrl('Alice', 'socket-2', false)
    const svg = atob(url.replace('data:image/svg+xml;base64,', ''))
    expect(svg).toContain('font-size="14"')
  })
})
