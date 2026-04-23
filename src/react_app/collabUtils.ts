import escape from 'lodash.escape'

/**
 * Replicate Excalidraw's getClientColor hash so we can bake the background
 * colour directly into the SVG avatar (the Avatar component drops its
 * coloured background when an `src` / img is provided).
 */
export function hashToInteger(id: string): number {
  let hash = 0
  if (id.length === 0) return hash
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i)
    hash = (hash << 5) - hash + char
  }
  return hash
}

/**
 * Must mirror Excalidraw's getClientColor (packages/excalidraw/clients.ts)
 * so the avatar background matches the cursor-arrow colour.
 */
export function getClientColor(clientId: string): string {
  const hash = Math.abs(hashToInteger(clientId))
  const hue = (hash % 37) * 10
  return `hsl(${hue}, 100%, 83%)`
}

export function escapeSvg(str: string): string {
  return escape(str)
}

/**
 * Generate an SVG data-URI avatar: coloured circle with two-letter initials.
 * For read-only users a small eye badge is rendered at the bottom-right.
 */
export function generateInitialsAvatarUrl(
  name: string,
  socketId: string,
  isReadOnly: boolean
): string {
  // Strip trailing parenthetical suffixes like "(Guest)" or "(View Only)" before extracting initials
  const cleanName = name.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const parts = cleanName.split(/\s+/)
  const first = parts[0]?.[0]?.toUpperCase() || '?'
  const last = parts.length > 1 ? parts[parts.length - 1][0]?.toUpperCase() : ''
  const initials = first + last
  const bg = getClientColor(socketId)

  const viewOnly = isReadOnly
    ? `<circle cx="16" cy="16" r="15.5" fill="none" stroke="red" stroke-width="1"/>`
    : ''

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="16" fill="${bg}"/>
    ${viewOnly}
    <text x="16" y="16" text-anchor="middle" dominant-baseline="central"
          font-family="Arial,sans-serif" font-size="${initials.length > 1 ? '12' : '14'}" font-weight="600" fill="#333">${escapeSvg(initials)}</text>
  </svg>`

  return `data:image/svg+xml;base64,${btoa(svg)}`
}
