import './NameChangeBanner.css'
import { translateExtensionLabel } from '../i18n'

interface NameChangeBannerProps {
  message: string
  langCode?: string
}

export default function NameChangeBanner({ message, langCode }: NameChangeBannerProps) {
  const [oldName, newName] = message.split(' → ')

  return (
    <div className="name-change-banner">
      {translateExtensionLabel(langCode, '"{oldName}" changed their name to "{newName}"')
        .replace('{oldName}', oldName)
        .replace('{newName}', newName)}
    </div>
  )
}
