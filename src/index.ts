import {
  ApplicationInformation,
  AppMenuItemExtension,
  AppWrapperRoute,
  defineWebApplication,
  useUserStore,
  useOpenEmptyEditor,
  useSpacesStore
} from '@opencloud-eu/web-pkg'
import { urlJoin } from '@opencloud-eu/web-client'
import '@opencloud-eu/extension-sdk/tailwind.css'
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'
import App from './App.vue'
import translations from '../l10n/translations.json'

const applicationId = 'excalidraw'

export default defineWebApplication({
  setup() {
    const { $gettext } = useGettext()
    const userStore = useUserStore()
    const { openEmptyEditor } = useOpenEmptyEditor()
    const spacesStore = useSpacesStore()

    const appInfo: ApplicationInformation = {
      name: 'Whiteboard',
      id: applicationId,
      icon: 'pencil-ruler',
      color: '#6965db',
      defaultExtension: 'excalidraw',
      translations,
      extensions: [
        {
          extension: 'excalidraw',
          routeName: 'excalidraw',
          newFileMenu: {
            menuTitle: () => $gettext('Whiteboard')
          }
        }
      ]
    }

    const routes = [
      {
        name: 'excalidraw',
        path: '/:driveAliasAndItem(.*)?',
        component: AppWrapperRoute(App, {
          applicationId,
          disableAutoSave: true
        }),
        meta: {
          authContext: 'hybrid',
          patchCleanPath: true
        }
      }
    ]

    const menuItems = computed<AppMenuItemExtension[]>(() => {
      const items: AppMenuItemExtension[] = []

      if (userStore.user && spacesStore.personalSpace) {
        items.push({
          id: `app.${appInfo.id}.menuItem`,
          type: 'appMenuItem',
          label: () => appInfo.name,
          color: appInfo.color,
          icon: appInfo.icon,
          priority: 30,
          path: urlJoin(appInfo.id),
          handler: () => openEmptyEditor(appInfo.id, appInfo.defaultExtension)
        })
      }

      return items
    })

    return {
      appInfo,
      routes,
      extensions: menuItems
    }
  }
})
