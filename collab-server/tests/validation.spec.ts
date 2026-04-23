import { describe, expect, it } from 'vitest'
import {
  isValidRoomID,
  checkBroadcastRate,
  BROADCAST_RATE_LIMIT,
  BROADCAST_REFILL_MS
} from '../src/validation.js'
import type { RateLimitData } from '../src/validation.js'

describe('isValidRoomID', () => {
  it('accepts a standard collaboration room ID', () => {
    expect(isValidRoomID('excalidraw:file:abc-123$def-456!ghi-789')).toBe(true)
  })

  it('accepts a follow-mode room ID', () => {
    expect(isValidRoomID('follow@socket123')).toBe(true)
  })

  it('accepts alphanumeric strings', () => {
    expect(isValidRoomID('simpleRoom42')).toBe(true)
  })

  it('accepts underscores, hyphens, colons, dots', () => {
    expect(isValidRoomID('room_name-with:colons.dots')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidRoomID('')).toBe(false)
  })

  it('rejects non-string values', () => {
    expect(isValidRoomID(null)).toBe(false)
    expect(isValidRoomID(undefined)).toBe(false)
    expect(isValidRoomID(123)).toBe(false)
    expect(isValidRoomID({})).toBe(false)
  })

  it('rejects strings longer than 512 characters', () => {
    expect(isValidRoomID('a'.repeat(512))).toBe(true)
    expect(isValidRoomID('a'.repeat(513))).toBe(false)
  })

  it('rejects strings with spaces', () => {
    expect(isValidRoomID('room name')).toBe(false)
  })

  it('rejects strings with path traversal characters', () => {
    expect(isValidRoomID('room/../etc')).toBe(false)
    expect(isValidRoomID('room/id')).toBe(false)
  })

  it('rejects strings with special injection characters', () => {
    expect(isValidRoomID('room<script>')).toBe(false)
    expect(isValidRoomID('room;drop')).toBe(false)
  })
})

describe('checkBroadcastRate', () => {
  function makeSocket(): { data: RateLimitData } {
    return {
      data: {
        _broadcastTokens: BROADCAST_RATE_LIMIT,
        _broadcastLastRefill: Date.now()
      }
    }
  }

  it('allows the first message', () => {
    const socket = makeSocket()
    expect(checkBroadcastRate(socket)).toBe(true)
  })

  it('decrements the token counter each call', () => {
    const socket = makeSocket()
    checkBroadcastRate(socket)
    expect(socket.data._broadcastTokens).toBe(BROADCAST_RATE_LIMIT - 1)
  })

  it('allows up to BROADCAST_RATE_LIMIT messages in a window', () => {
    const socket = makeSocket()
    for (let i = 0; i < BROADCAST_RATE_LIMIT; i++) {
      expect(checkBroadcastRate(socket)).toBe(true)
    }
    // Next call should be rejected
    expect(checkBroadcastRate(socket)).toBe(false)
  })

  it('refills tokens after the refill interval elapses', () => {
    const socket = makeSocket()
    // Drain all tokens
    for (let i = 0; i < BROADCAST_RATE_LIMIT; i++) {
      checkBroadcastRate(socket)
    }
    expect(checkBroadcastRate(socket)).toBe(false)

    // Simulate time passing beyond the refill window
    socket.data._broadcastLastRefill = Date.now() - BROADCAST_REFILL_MS - 1
    expect(checkBroadcastRate(socket)).toBe(true)
    // Tokens should have been refilled
    expect(socket.data._broadcastTokens).toBe(BROADCAST_RATE_LIMIT - 1)
  })

  it('does not refill before the interval elapses', () => {
    const socket = makeSocket()
    // Drain all tokens
    for (let i = 0; i < BROADCAST_RATE_LIMIT; i++) {
      checkBroadcastRate(socket)
    }
    // Set last refill to just recently (within the window)
    socket.data._broadcastLastRefill = Date.now() - BROADCAST_REFILL_MS / 2
    expect(checkBroadcastRate(socket)).toBe(false)
  })
})
