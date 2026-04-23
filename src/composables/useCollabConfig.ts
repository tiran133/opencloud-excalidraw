import { computed, ComputedRef } from 'vue'
import { Resource } from '@opencloud-eu/web-client'
import { AppConfig } from '../helpers/appConfigSchema'
import { useSpacesStore } from '@opencloud-eu/web-pkg'

export function useCollabConfig(
  appConfig: ComputedRef<AppConfig>,
  resource: ComputedRef<Resource>
) {
  const spacesStore = useSpacesStore()

  const collabServerUrl = computed(() => {
    return appConfig.value.collabServerUrl || `${window.location.origin}/excalidraw-collab/`
  })

  const roomId = computed(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const fileId = urlParams.get('fileId') || resource.value?.id
    if (!fileId) return undefined
    return `excalidraw:file:${fileId}`
  })

  const isCollabMode = computed(() => {
    if (!appConfig.value.collabServerEnabled || !collabServerUrl.value || !roomId.value) {
      return false
    }

    const isPersonalSpace = spacesStore.personalSpace?.storageId === resource.value.storageId

    // Personal space requires the file to be explicitly shared
    if (isPersonalSpace) {
      return (resource.value.shareTypes?.length ?? 0) > 0
    }

    // Other spaces (e.g. project spaces) are inherently collaborative
    return true
  })

  return {
    collabServerUrl,
    roomId,
    isCollabMode
  }
}
