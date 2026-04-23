import { ref, computed, ComputedRef } from 'vue'
import { useAuthStore, useUserStore } from '@opencloud-eu/web-pkg'

const PUBLIC_LINK_NAME_KEY = 'oc.excalidraw.publicLinkDisplayName'

export function usePublicLinkIdentity(isCollabMode: ComputedRef<boolean>) {
  const authStore = useAuthStore()
  const userStore = useUserStore()

  const accessToken = computed(() => authStore.accessToken)

  const isPublicLink = computed(() => {
    return authStore.publicLinkContextReady && !!authStore.publicLinkToken
  })

  const publicLinkToken = computed(() => authStore.publicLinkToken)
  const publicLinkPassword = computed(() => authStore.publicLinkPassword)

  // Name prompt state for public link users
  const publicDisplayName = ref('')
  const nameConfirmed = ref(false)
  const isNameChangeInProgress = ref(false)
  const storedName = sessionStorage.getItem(PUBLIC_LINK_NAME_KEY) || ''
  if (storedName) {
    publicDisplayName.value = storedName
    nameConfirmed.value = true
  }

  const showNamePrompt = computed(() => {
    return isPublicLink.value && isCollabMode.value && !nameConfirmed.value
  })

  function onNameConfirmed(name: string) {
    publicDisplayName.value = name
    nameConfirmed.value = true
    isNameChangeInProgress.value = false
    sessionStorage.setItem(PUBLIC_LINK_NAME_KEY, name)
  }

  function requestNameChange() {
    isNameChangeInProgress.value = true
    nameConfirmed.value = false
  }

  const username = computed(() => {
    if (isPublicLink.value) {
      return publicDisplayName.value || 'Guest'
    }
    return userStore.user?.displayName || userStore.user?.onPremisesSamAccountName || 'Anonymous'
  })

  return {
    accessToken,
    isPublicLink,
    publicLinkToken,
    publicLinkPassword,
    showNamePrompt,
    isNameChangeInProgress,
    onNameConfirmed,
    requestNameChange,
    username
  }
}
