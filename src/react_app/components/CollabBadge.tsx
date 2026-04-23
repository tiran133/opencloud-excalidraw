import './CollabBadge.css'
import { translateExtensionLabel } from '../i18n'

type CollabState = 'connected' | 'connecting' | 'reconnecting' | 'offline' | 'disconnected'

interface CollabBadgeProps {
  collabState: CollabState
  langCode?: string
}

const labelMap: Record<CollabState, string> = {
  connected: 'Live',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
  disconnected: 'Disconnected'
}

export default function CollabBadge({ collabState, langCode }: CollabBadgeProps) {
  const dot = collabState === 'connected' ? '●' : '○'
  const label = translateExtensionLabel(langCode, labelMap[collabState])

  return <div className={`collab-badge collab-badge--${collabState}`}>{`${dot} ${label}`}</div>
}
