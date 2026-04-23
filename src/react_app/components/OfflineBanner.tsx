import './OfflineBanner.css'
import { translateExtensionLabel } from '../i18n'

interface OfflineBannerProps {
  langCode?: string
}

export default function OfflineBanner({ langCode }: OfflineBannerProps) {
  return (
    <div className="offline-banner">
      {translateExtensionLabel(
        langCode,
        'You are offline. Changes will be saved once you are back online.'
      )}
    </div>
  )
}
