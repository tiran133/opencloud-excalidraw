/**
 * Pure state-management helpers extracted from CollabManager.
 *
 * These functions handle collaborator map building, element version
 * filtering, broadcast message construction / parsing, and display-name
 * formatting — all without any Socket.IO or Excalidraw API dependency.
 */

import type { Collaborator, Gesture } from '@excalidraw/excalidraw/types'
import { generateInitialsAvatarUrl } from './collabUtils'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExtendedCollaborator = Collaborator & {
  _rawUsername?: string
  _isReadOnly?: boolean
  _isGuest?: boolean
}

export type CollabState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'offline'

export interface PointerUpdatePayload {
  pointer: { x: number; y: number; tool: 'pointer' | 'laser' }
  button: 'down' | 'up'
  pointersMap: Gesture['pointers']
}

/** The wire-protocol subtypes used in broadcast messages. */
export const WS_SUBTYPES = {
  INIT: 'SCENE_INIT',
  UPDATE: 'SCENE_UPDATE',
  MOUSE_LOCATION: 'MOUSE_LOCATION',
  IDLE_STATUS: 'IDLE_STATUS',
  USER_VISIBLE_SCENE_BOUNDS: 'USER_VISIBLE_SCENE_BOUNDS'
} as const

// ─── Display name ────────────────────────────────────────────────────────────

/**
 * Build a display name, appending localised "(Guest)" and/or "(View Only)"
 * suffixes as appropriate.
 *
 * @param rawName        The collaborator's real name
 * @param isReadOnly     Whether they are in read-only mode
 * @param viewOnlyLabel  Already-translated "View Only" string
 * @param isGuest        Whether the collaborator is a public-link guest
 * @param guestLabel     Already-translated "Guest" string
 */
export function displayName(
  rawName: string | undefined,
  isReadOnly: boolean,
  viewOnlyLabel: string,
  isGuest?: boolean,
  guestLabel?: string
): string | undefined {
  if (!rawName) return rawName
  let name = rawName
  if (isGuest && guestLabel) {
    name = `${name} (${guestLabel})`
  }
  if (isReadOnly) {
    name = `${name} (${viewOnlyLabel})`
  }
  return name
}

// ─── Collaborator map helpers ────────────────────────────────────────────────

export interface BuildCollaboratorOpts {
  socketId: string
  mySocketId: string | undefined
  myUsername: string
  myReadOnly: boolean
  myIsGuest: boolean
  existing: Partial<ExtendedCollaborator>
  viewOnlyLabel: string
  guestLabel: string
}

/**
 * Build a single collaborator entry from its constituent parts.
 * Pure function — no side-effects.
 */
export function buildCollaborator(opts: BuildCollaboratorOpts): ExtendedCollaborator {
  const {
    socketId,
    mySocketId,
    myUsername,
    myReadOnly,
    myIsGuest,
    existing,
    viewOnlyLabel,
    guestLabel
  } = opts
  const isMe = socketId === mySocketId
  const rawName = isMe ? myUsername : existing._rawUsername
  const isRO = isMe ? myReadOnly : (existing._isReadOnly ?? false)
  const isGuest = isMe ? myIsGuest : (existing._isGuest ?? false)
  const name = displayName(rawName, isRO, viewOnlyLabel, isGuest, guestLabel)

  return {
    ...existing,
    isCurrentUser: isMe,
    username: name,
    _rawUsername: rawName,
    _isReadOnly: isRO,
    _isGuest: isGuest,
    avatarUrl: rawName ? generateInitialsAvatarUrl(rawName, socketId, isRO) : undefined
  }
}

export interface SetCollaboratorsOpts {
  socketIds: string[]
  mySocketId: string | undefined
  myUsername: string
  myReadOnly: boolean
  myIsGuest: boolean
  existing: Map<string, ExtendedCollaborator>
  viewOnlyLabel: string
  guestLabel: string
}

/**
 * Rebuild the full collaborator map from a fresh list of socket IDs.
 * Preserves existing metadata (pointer position, etc.) for known sockets.
 */
export function buildCollaboratorMap(
  opts: SetCollaboratorsOpts
): Map<string, ExtendedCollaborator> {
  const {
    socketIds,
    mySocketId,
    myUsername,
    myReadOnly,
    myIsGuest,
    existing,
    viewOnlyLabel,
    guestLabel
  } = opts
  const map = new Map<string, ExtendedCollaborator>()
  for (const socketId of socketIds) {
    map.set(
      socketId,
      buildCollaborator({
        socketId,
        mySocketId,
        myUsername,
        myReadOnly,
        myIsGuest,
        existing: existing.get(socketId) || {},
        viewOnlyLabel,
        guestLabel
      })
    )
  }
  return map
}

export interface UpdateCollaboratorOpts {
  socketId: string
  updates: Partial<ExtendedCollaborator>
  remoteReadOnly?: boolean
  remoteIsGuest?: boolean
  mySocketId: string | undefined
  myUsername: string
  myReadOnly: boolean
  myIsGuest: boolean
  collaborators: Map<string, ExtendedCollaborator>
  viewOnlyLabel: string
  guestLabel: string
}

/**
 * Produce a new collaborator map with one entry updated.
 * Returns a fresh Map (immutable-style).
 */
export function updateCollaboratorInMap(
  opts: UpdateCollaboratorOpts
): Map<string, ExtendedCollaborator> {
  const {
    socketId,
    updates,
    remoteReadOnly,
    remoteIsGuest,
    mySocketId,
    myReadOnly,
    myIsGuest,
    collaborators,
    viewOnlyLabel,
    guestLabel
  } = opts
  const map = new Map(collaborators)
  const existing = map.get(socketId) || {}
  const isMe = socketId === mySocketId
  const rawName = updates.username ?? existing._rawUsername
  const isRO = isMe ? myReadOnly : (remoteReadOnly ?? existing._isReadOnly ?? false)
  const isGuest = isMe ? myIsGuest : (remoteIsGuest ?? existing._isGuest ?? false)
  const name = displayName(rawName, isRO, viewOnlyLabel, isGuest, guestLabel)

  map.set(socketId, {
    ...existing,
    ...updates,
    isCurrentUser: isMe,
    username: name,
    _rawUsername: rawName,
    _isReadOnly: isRO,
    _isGuest: isGuest,
    avatarUrl: rawName ? generateInitialsAvatarUrl(rawName, socketId, isRO) : undefined
  })
  return map
}

// ─── Element version filtering ───────────────────────────────────────────────

export interface ElementLike {
  id: string
  version: number
}

/**
 * Filter elements to only those whose version is newer than what was
 * previously broadcast. When `syncAll` is true, returns all elements.
 *
 * Returns the filtered list and an updated version map.
 */
export function filterChangedElements(
  elements: readonly ElementLike[],
  broadcastedVersions: Map<string, number>,
  syncAll: boolean
): { toSend: ElementLike[]; updatedVersions: Map<string, number> } {
  const toSend = syncAll
    ? [...elements]
    : elements.filter((el) => {
        const prev = broadcastedVersions.get(el.id)
        return prev === undefined || el.version > prev
      })

  const updatedVersions = new Map(broadcastedVersions)
  for (const el of toSend) {
    updatedVersions.set(el.id, el.version)
  }

  return { toSend, updatedVersions }
}

// ─── Broadcast message construction ─────────────────────────────────────────

/**
 * Build a scene broadcast payload (SCENE_INIT or SCENE_UPDATE).
 * When `files` is provided, image binary data is included so remote
 * peers can render images without a separate fetch.
 */
export function buildScenePayload(
  updateType: typeof WS_SUBTYPES.INIT | typeof WS_SUBTYPES.UPDATE,
  elements: readonly ElementLike[],
  files?: Record<string, unknown>
): string {
  const payload: Record<string, unknown> = { elements }
  if (files && Object.keys(files).length > 0) {
    payload.files = files
  }
  return JSON.stringify({
    type: updateType,
    payload
  })
}

/**
 * Build a mouse-location broadcast payload.
 */
export function buildMousePayload(
  socketId: string,
  pointer: { x: number; y: number; tool: 'pointer' | 'laser' },
  button: string,
  selectedElementIds: Record<string, boolean>,
  username: string,
  isReadOnly: boolean,
  isGuest: boolean
): string {
  return JSON.stringify({
    type: WS_SUBTYPES.MOUSE_LOCATION,
    payload: { socketId, pointer, button, selectedElementIds, username, isReadOnly, isGuest }
  })
}

/**
 * Build an idle/presence broadcast payload.
 */
export function buildIdlePayload(
  socketId: string,
  username: string,
  isReadOnly: boolean,
  isGuest: boolean
): string {
  return JSON.stringify({
    type: WS_SUBTYPES.IDLE_STATUS,
    payload: {
      socketId,
      userState: isReadOnly ? 'idle' : 'active',
      username,
      isReadOnly,
      isGuest
    }
  })
}

// ─── Broadcast message parsing ───────────────────────────────────────────────

export type ParsedBroadcast =
  | {
      type: typeof WS_SUBTYPES.INIT | typeof WS_SUBTYPES.UPDATE
      payload: { elements: unknown[]; files?: Record<string, unknown> }
    }
  | {
      type: typeof WS_SUBTYPES.MOUSE_LOCATION
      payload: {
        socketId: string
        pointer: unknown
        button: string
        username?: string
        selectedElementIds?: unknown
        isReadOnly?: boolean
        isGuest?: boolean
      }
    }
  | {
      type: typeof WS_SUBTYPES.IDLE_STATUS
      payload: {
        socketId: string
        userState: string
        username?: string
        isReadOnly?: boolean
        isGuest?: boolean
      }
    }
  | {
      type: typeof WS_SUBTYPES.USER_VISIBLE_SCENE_BOUNDS
      payload: { socketId: string; sceneBounds: unknown }
    }

/**
 * Decode a raw broadcast (ArrayBuffer or string) into a typed message.
 * Returns null if parsing fails.
 */
export function parseBroadcast(rawData: ArrayBuffer | string): ParsedBroadcast | null {
  try {
    let jsonStr: string
    if (typeof rawData === 'string') {
      jsonStr = rawData
    } else if (rawData instanceof ArrayBuffer) {
      jsonStr = new TextDecoder().decode(rawData)
    } else {
      jsonStr = new TextDecoder().decode(new Uint8Array(rawData as ArrayBuffer))
    }
    return JSON.parse(jsonStr)
  } catch {
    return null
  }
}

/**
 * Determine whether this client should follow-viewport updates from a
 * particular sender, avoiding infinite cross-follow loops.
 */
export function shouldApplyViewportFollow(
  senderSocketId: string,
  userToFollowSocketId: string | undefined,
  followedBy: Set<string>
): boolean {
  if (userToFollowSocketId !== senderSocketId) return false
  if (followedBy.has(senderSocketId)) return false
  return true
}
