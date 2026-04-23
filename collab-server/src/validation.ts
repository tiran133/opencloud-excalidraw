// Rate limiting constants
export const BROADCAST_RATE_LIMIT = 240
export const BROADCAST_REFILL_MS = 1000

export interface RateLimitData {
  _broadcastTokens: number
  _broadcastLastRefill: number
}

interface SocketWithRateLimit {
  data: RateLimitData
}

/**
 * Token-bucket rate limiter for broadcast messages.
 * Returns true if the message is allowed, false if rate-limited.
 *
 * Expects socket.data to have _broadcastTokens and _broadcastLastRefill.
 */
export function checkBroadcastRate(socket: SocketWithRateLimit): boolean {
  const now = Date.now()
  const elapsed = now - socket.data._broadcastLastRefill
  if (elapsed >= BROADCAST_REFILL_MS) {
    socket.data._broadcastTokens = BROADCAST_RATE_LIMIT
    socket.data._broadcastLastRefill = now
  }
  if (socket.data._broadcastTokens <= 0) return false
  socket.data._broadcastTokens--
  return true
}

/**
 * Validate a Socket.IO room ID.
 *   excalidraw:file:<uuid$uuid!uuid> — normal collaboration rooms
 *   follow@<socketId> — follow-mode viewport relay rooms
 * Allow alphanumeric, hyphens, underscores, colons, dots, $, !, @
 */
export function isValidRoomID(roomID: unknown): roomID is string {
  if (typeof roomID !== 'string' || roomID.length === 0 || roomID.length > 512) return false
  return /^[\w:.\-$!@]+$/.test(roomID)
}
