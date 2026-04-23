import { describe, expect, it } from 'vitest'

import {
  WS_SUBTYPES,
  displayName,
  buildCollaborator,
  buildCollaboratorMap,
  updateCollaboratorInMap,
  filterChangedElements,
  buildScenePayload,
  buildMousePayload,
  buildIdlePayload,
  parseBroadcast,
  shouldApplyViewportFollow
} from '../../src/react_app/collabState'

// ─── WS_SUBTYPES ─────────────────────────────────────────────────────────────

describe('WS_SUBTYPES', () => {
  it('has the expected protocol values', () => {
    expect(WS_SUBTYPES.INIT).toBe('SCENE_INIT')
    expect(WS_SUBTYPES.UPDATE).toBe('SCENE_UPDATE')
    expect(WS_SUBTYPES.MOUSE_LOCATION).toBe('MOUSE_LOCATION')
    expect(WS_SUBTYPES.IDLE_STATUS).toBe('IDLE_STATUS')
    expect(WS_SUBTYPES.USER_VISIBLE_SCENE_BOUNDS).toBe('USER_VISIBLE_SCENE_BOUNDS')
  })
})

// ─── displayName ─────────────────────────────────────────────────────────────

describe('displayName', () => {
  it('returns rawName unchanged for non-read-only users', () => {
    expect(displayName('Alice', false, 'View Only')).toBe('Alice')
  })

  it('appends view-only label for read-only users', () => {
    expect(displayName('Bob', true, 'View Only')).toBe('Bob (View Only)')
  })

  it('uses localised label', () => {
    expect(displayName('Hans', true, 'Nur Ansicht')).toBe('Hans (Nur Ansicht)')
  })

  it('returns undefined when rawName is undefined', () => {
    expect(displayName(undefined, false, 'View Only')).toBeUndefined()
    expect(displayName(undefined, true, 'View Only')).toBeUndefined()
  })

  it('returns empty string unchanged for non-read-only', () => {
    expect(displayName('', false, 'View Only')).toBe('')
  })
})

// ─── buildCollaborator ───────────────────────────────────────────────────────

describe('buildCollaborator', () => {
  const baseOpts = {
    socketId: 'sock-1',
    mySocketId: 'sock-1',
    myUsername: 'Alice',
    myReadOnly: false,
    existing: {},
    viewOnlyLabel: 'View Only'
  }

  it('marks the current user correctly', () => {
    const c = buildCollaborator(baseOpts)
    expect(c.isCurrentUser).toBe(true)
    expect(c._rawUsername).toBe('Alice')
    expect(c.username).toBe('Alice')
  })

  it('marks remote users as not current', () => {
    const c = buildCollaborator({ ...baseOpts, socketId: 'sock-2' })
    expect(c.isCurrentUser).toBe(false)
    // No _rawUsername from existing, so undefined
    expect(c._rawUsername).toBeUndefined()
  })

  it('preserves existing properties', () => {
    const c = buildCollaborator({
      ...baseOpts,
      socketId: 'sock-2',
      existing: { _rawUsername: 'Bob', pointer: { x: 10, y: 20 } as any }
    })
    expect(c._rawUsername).toBe('Bob')
    expect(c.pointer).toEqual({ x: 10, y: 20 })
  })

  it('generates avatar URL when rawName is present', () => {
    const c = buildCollaborator(baseOpts)
    expect(c.avatarUrl).toBeDefined()
    expect(c.avatarUrl).toContain('data:image/svg+xml')
  })

  it('does not generate avatar URL when rawName is undefined', () => {
    const c = buildCollaborator({ ...baseOpts, socketId: 'sock-2', existing: {} })
    expect(c.avatarUrl).toBeUndefined()
  })

  it('appends view-only suffix for read-only current user', () => {
    const c = buildCollaborator({ ...baseOpts, myReadOnly: true })
    expect(c.username).toBe('Alice (View Only)')
    expect(c._isReadOnly).toBe(true)
  })

  it('uses existing _isReadOnly for remote users', () => {
    const c = buildCollaborator({
      ...baseOpts,
      socketId: 'sock-2',
      existing: { _rawUsername: 'Bob', _isReadOnly: true }
    })
    expect(c.username).toBe('Bob (View Only)')
    expect(c._isReadOnly).toBe(true)
  })
})

// ─── buildCollaboratorMap ────────────────────────────────────────────────────

describe('buildCollaboratorMap', () => {
  it('builds a map with entries for each socket ID', () => {
    const map = buildCollaboratorMap({
      socketIds: ['s1', 's2', 's3'],
      mySocketId: 's1',
      myUsername: 'Me',
      myReadOnly: false,
      existing: new Map(),
      viewOnlyLabel: 'View Only'
    })
    expect(map.size).toBe(3)
    expect(map.get('s1')?.isCurrentUser).toBe(true)
    expect(map.get('s2')?.isCurrentUser).toBe(false)
  })

  it('preserves existing metadata for known sockets', () => {
    const existing = new Map([['s2', { _rawUsername: 'Bob', pointer: { x: 5, y: 5 } } as any]])
    const map = buildCollaboratorMap({
      socketIds: ['s1', 's2'],
      mySocketId: 's1',
      myUsername: 'Me',
      myReadOnly: false,
      existing,
      viewOnlyLabel: 'View Only'
    })
    expect(map.get('s2')?.pointer).toEqual({ x: 5, y: 5 })
    expect(map.get('s2')?._rawUsername).toBe('Bob')
  })

  it('drops sockets no longer in the list', () => {
    const existing = new Map([['s-old', { _rawUsername: 'Left' } as any]])
    const map = buildCollaboratorMap({
      socketIds: ['s1'],
      mySocketId: 's1',
      myUsername: 'Me',
      myReadOnly: false,
      existing,
      viewOnlyLabel: 'View Only'
    })
    expect(map.has('s-old')).toBe(false)
  })
})

// ─── updateCollaboratorInMap ─────────────────────────────────────────────────

describe('updateCollaboratorInMap', () => {
  it('adds a new collaborator if not in the map', () => {
    const map = updateCollaboratorInMap({
      socketId: 'new-sock',
      updates: { username: 'Charlie' },
      mySocketId: 'my-sock',
      myUsername: 'Me',
      myReadOnly: false,
      collaborators: new Map(),
      viewOnlyLabel: 'View Only'
    })
    expect(map.size).toBe(1)
    expect(map.get('new-sock')?._rawUsername).toBe('Charlie')
  })

  it('merges updates into an existing collaborator', () => {
    const existing = new Map<string, any>([
      ['s1', { _rawUsername: 'Alice', pointer: { x: 0, y: 0 } }]
    ])
    const map = updateCollaboratorInMap({
      socketId: 's1',
      updates: { pointer: { x: 99, y: 99 } as any },
      mySocketId: 'other',
      myUsername: 'Me',
      myReadOnly: false,
      collaborators: existing,
      viewOnlyLabel: 'View Only'
    })
    expect(map.get('s1')?.pointer).toEqual({ x: 99, y: 99 })
    expect(map.get('s1')?._rawUsername).toBe('Alice')
  })

  it('returns a new Map instance (immutable)', () => {
    const original = new Map<string, any>()
    const updated = updateCollaboratorInMap({
      socketId: 's1',
      updates: { username: 'X' },
      mySocketId: 'other',
      myUsername: 'Me',
      myReadOnly: false,
      collaborators: original,
      viewOnlyLabel: 'View Only'
    })
    expect(updated).not.toBe(original)
  })

  it('applies remoteReadOnly for non-current users', () => {
    const map = updateCollaboratorInMap({
      socketId: 'remote',
      updates: { username: 'Bob' },
      remoteReadOnly: true,
      mySocketId: 'me',
      myUsername: 'Me',
      myReadOnly: false,
      collaborators: new Map(),
      viewOnlyLabel: 'View Only'
    })
    expect(map.get('remote')?._isReadOnly).toBe(true)
    expect(map.get('remote')?.username).toBe('Bob (View Only)')
  })
})

// ─── filterChangedElements ───────────────────────────────────────────────────

describe('filterChangedElements', () => {
  const elements = [
    { id: 'a', version: 1 },
    { id: 'b', version: 2 },
    { id: 'c', version: 3 }
  ]

  it('returns all elements when syncAll is true', () => {
    const prev = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3]
    ])
    const { toSend } = filterChangedElements(elements, prev, true)
    expect(toSend).toHaveLength(3)
  })

  it('filters to only new/updated elements when syncAll is false', () => {
    const prev = new Map([
      ['a', 1],
      ['b', 2]
    ])
    const { toSend } = filterChangedElements(elements, prev, false)
    // 'c' is new (not in prev), 'a' and 'b' have same version → only 'c'
    expect(toSend).toHaveLength(1)
    expect(toSend[0].id).toBe('c')
  })

  it('includes elements with a higher version than previously broadcast', () => {
    const prev = new Map([
      ['a', 0],
      ['b', 1]
    ])
    const { toSend } = filterChangedElements(elements, prev, false)
    // a: 1>0 → yes, b: 2>1 → yes, c: new → yes
    expect(toSend).toHaveLength(3)
  })

  it('returns updated version map with sent elements', () => {
    const prev = new Map<string, number>()
    const { updatedVersions } = filterChangedElements(elements, prev, false)
    expect(updatedVersions.get('a')).toBe(1)
    expect(updatedVersions.get('b')).toBe(2)
    expect(updatedVersions.get('c')).toBe(3)
  })

  it('does not mutate the original version map', () => {
    const prev = new Map<string, number>()
    filterChangedElements(elements, prev, false)
    expect(prev.size).toBe(0)
  })

  it('returns empty list when nothing changed', () => {
    const prev = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3]
    ])
    const { toSend } = filterChangedElements(elements, prev, false)
    expect(toSend).toHaveLength(0)
  })
})

// ─── buildScenePayload ──────────────────────────────────────────────────────

describe('buildScenePayload', () => {
  it('builds a JSON string with the correct type for INIT', () => {
    const payload = JSON.parse(buildScenePayload(WS_SUBTYPES.INIT, [{ id: 'x', version: 1 }]))
    expect(payload.type).toBe('SCENE_INIT')
    expect(payload.payload.elements).toHaveLength(1)
  })

  it('builds a JSON string with the correct type for UPDATE', () => {
    const payload = JSON.parse(buildScenePayload(WS_SUBTYPES.UPDATE, []))
    expect(payload.type).toBe('SCENE_UPDATE')
    expect(payload.payload.elements).toHaveLength(0)
  })
})

// ─── buildMousePayload ──────────────────────────────────────────────────────

describe('buildMousePayload', () => {
  it('includes all mouse location fields', () => {
    const payload = JSON.parse(
      buildMousePayload(
        's1',
        { x: 10, y: 20, tool: 'pointer' },
        'down',
        { el1: true },
        'Alice',
        false
      )
    )
    expect(payload.type).toBe('MOUSE_LOCATION')
    expect(payload.payload.socketId).toBe('s1')
    expect(payload.payload.pointer).toEqual({ x: 10, y: 20, tool: 'pointer' })
    expect(payload.payload.button).toBe('down')
    expect(payload.payload.username).toBe('Alice')
    expect(payload.payload.isReadOnly).toBe(false)
  })
})

// ─── buildIdlePayload ────────────────────────────────────────────────────────

describe('buildIdlePayload', () => {
  it('sets userState to "active" for non-read-only', () => {
    const payload = JSON.parse(buildIdlePayload('s1', 'Alice', false))
    expect(payload.type).toBe('IDLE_STATUS')
    expect(payload.payload.userState).toBe('active')
  })

  it('sets userState to "idle" for read-only', () => {
    const payload = JSON.parse(buildIdlePayload('s1', 'Bob', true))
    expect(payload.payload.userState).toBe('idle')
    expect(payload.payload.isReadOnly).toBe(true)
  })
})

// ─── parseBroadcast ──────────────────────────────────────────────────────────

describe('parseBroadcast', () => {
  it('parses a JSON string', () => {
    const msg = JSON.stringify({ type: 'SCENE_UPDATE', payload: { elements: [] } })
    const result = parseBroadcast(msg)
    expect(result?.type).toBe('SCENE_UPDATE')
  })

  it('parses an ArrayBuffer', () => {
    const msg = JSON.stringify({ type: 'IDLE_STATUS', payload: { socketId: 's1' } })
    const buf = new TextEncoder().encode(msg).buffer
    const result = parseBroadcast(buf)
    expect(result?.type).toBe('IDLE_STATUS')
  })

  it('returns null on invalid JSON', () => {
    expect(parseBroadcast('not json')).toBeNull()
  })

  it('returns null on empty string', () => {
    expect(parseBroadcast('')).toBeNull()
  })

  it('round-trips with buildScenePayload', () => {
    const original = buildScenePayload(WS_SUBTYPES.INIT, [{ id: 'x', version: 5 }])
    const parsed = parseBroadcast(original)
    expect(parsed?.type).toBe('SCENE_INIT')
    expect((parsed?.payload as any).elements[0].id).toBe('x')
  })

  it('round-trips with buildIdlePayload', () => {
    const original = buildIdlePayload('s1', 'Alice', true)
    const parsed = parseBroadcast(original)
    expect(parsed?.type).toBe('IDLE_STATUS')
    expect((parsed?.payload as any).userState).toBe('idle')
  })
})

// ─── shouldApplyViewportFollow ───────────────────────────────────────────────

describe('shouldApplyViewportFollow', () => {
  it('returns true when following the sender and no cross-follow', () => {
    expect(shouldApplyViewportFollow('s2', 's2', new Set())).toBe(true)
  })

  it('returns false when not following the sender', () => {
    expect(shouldApplyViewportFollow('s2', 's3', new Set())).toBe(false)
  })

  it('returns false when userToFollow is undefined', () => {
    expect(shouldApplyViewportFollow('s2', undefined, new Set())).toBe(false)
  })

  it('returns false for cross-follow (infinite loop prevention)', () => {
    // s2 is both who we follow AND who follows us → cross-follow
    expect(shouldApplyViewportFollow('s2', 's2', new Set(['s2']))).toBe(false)
  })

  it('returns true when followedBy contains other sockets but not the sender', () => {
    expect(shouldApplyViewportFollow('s2', 's2', new Set(['s3', 's4']))).toBe(true)
  })
})
