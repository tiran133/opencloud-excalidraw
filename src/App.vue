<script lang="ts">
import { defineComponent, ref, watch, computed, watchEffect, onUnmounted, PropType } from 'vue'
import { Resource } from '@opencloud-eu/web-client'
import { AppConfigObject, useThemeStore, useMessages } from '@opencloud-eu/web-pkg'
import ExcalidrawEditor from './components/ExcalidrawEditor.vue'
import NamePromptDialog from './components/NamePromptDialog.vue'
import { appConfigSchema, AppConfig } from './helpers/appConfigSchema'
import { useFileOperations } from './composables/useFileOperations'
import { usePublicLinkIdentity } from './composables/usePublicLinkIdentity'
import { useCollabConfig } from './composables/useCollabConfig'
import { useEditorLocale } from './composables/useEditorLocale'
import { useGettext } from 'vue3-gettext'

export default defineComponent({
  name: 'ExcalidrawApp',
  components: { ExcalidrawEditor, NamePromptDialog },
  props: {
    resource: {
      type: Object as PropType<Resource>,
      required: true
    },
    applicationConfig: {
      type: Object as PropType<AppConfigObject>,
      required: false,
      default: (): AppConfigObject => ({})
    },
    currentContent: {
      type: String,
      required: true
    },
    isReadOnly: {
      type: Boolean,
      required: true
    },
    isDirty: {
      type: Boolean,
      required: true
    }
  },
  emits: ['update:currentContent', 'save', 'close'],
  setup(props, { emit }) {
    const themeStore = useThemeStore()
    const { showErrorMessage } = useMessages()
    const { $gettext } = useGettext()

    const appConfig = computed<AppConfig>(() => {
      const result = appConfigSchema.safeParse(props.applicationConfig)
      if (!result.success) {
        console.error('[excalidraw] Invalid application config:', result.error.issues)
        return { collabServerEnabled: false, autoSaveIntervalMinutes: 5 }
      }
      return result.data
    })

    const isDarkTheme = computed(() => {
      return themeStore.currentTheme?.isDark ?? false
    })

    const { langCode } = useEditorLocale()

    //Enable only colabmode when file is shared with anyone
    const { collabServerUrl, roomId, isCollabMode } = useCollabConfig(
      appConfig,
      computed(() => props.resource)
    )

    const {
      accessToken,
      isPublicLink,
      publicLinkToken,
      publicLinkPassword,
      showNamePrompt,
      isNameChangeInProgress,
      onNameConfirmed,
      requestNameChange,
      username
    } = usePublicLinkIdentity(isCollabMode)

    const { collabSave } = useFileOperations({
      publicLinkToken: publicLinkToken.value,
      publicLinkPassword: publicLinkPassword.value
    })

    // Content sync
    const localChangeVersion = ref(0)
    const lastHandledVersion = ref(0)
    const editorContent = ref(props.currentContent || '')

    watch(
      () => props.currentContent,
      (newContent) => {
        if (localChangeVersion.value !== lastHandledVersion.value) {
          lastHandledVersion.value = localChangeVersion.value
          return
        }
        editorContent.value = newContent || ''
      }
    )

    // Called in collab mode — direct WebDAV PUT
    const saveErrorShown = ref(false)

    async function handleSave(data: string): Promise<void> {
      const webDavPath = props.resource?.webDavPath
      if (!webDavPath) {
        console.error('[excalidraw] No webDavPath on resource, cannot save')
        return
      }
      try {
        await collabSave(webDavPath, data)
        saveErrorShown.value = false
      } catch (error) {
        if (!saveErrorShown.value) {
          saveErrorShown.value = true
          const message = error instanceof Error ? error.message : String(error)
          showErrorMessage({
            title: $gettext('Failed to save drawing'),
            desc: message,
            errors: error instanceof Error ? [error] : undefined
          })
        }
        throw error
      }
    }

    function handleChange(data: string) {
      localChangeVersion.value++
      emit('update:currentContent', data)
    }

    watchEffect(() => {
      if (isCollabMode.value) {
        document.body.classList.add('excalidraw-collab-mode')
      } else {
        document.body.classList.remove('excalidraw-collab-mode')
      }
    })

    onUnmounted(() => {
      document.body.classList.remove('excalidraw-collab-mode')
    })

    return {
      appConfig,
      editorContent,
      handleChange,
      handleSave,
      collabServerUrl,
      roomId,
      username,
      isCollabMode,
      isDarkTheme,
      langCode,
      accessToken,
      isPublicLink,
      publicLinkToken,
      publicLinkPassword,
      showNamePrompt,
      isNameChangeInProgress,
      onNameConfirmed,
      requestNameChange
    }
  }
})
</script>

<template>
  <div class="excalidraw-app">
    <!-- Name prompt for public link users in collab mode -->
    <NamePromptDialog
      v-if="showNamePrompt"
      :initial-name="isNameChangeInProgress ? username : ''"
      @confirm="onNameConfirmed"
    />

    <!-- eslint-disable vue/attribute-hyphenation -->
    <ExcalidrawEditor
      v-if="!showNamePrompt || isNameChangeInProgress"
      :initialData="editorContent"
      :readOnly="isReadOnly"
      :collabServerUrl="collabServerUrl"
      :roomId="roomId"
      :username="username"
      :isCollabMode="isCollabMode"
      :isDarkTheme="isDarkTheme"
      :langCode="langCode"
      :accessToken="accessToken"
      :publicLinkToken="publicLinkToken"
      :publicLinkPassword="publicLinkPassword"
      :onRequestNameChange="requestNameChange"
      :onSave="handleSave"
      :autoSaveIntervalMinutes="appConfig.autoSaveIntervalMinutes"
      @change="handleChange"
    />
  </div>
</template>

<style scoped>
.excalidraw-app {
  width: 100%;
  height: 100%;
}
</style>

<style>
.excalidraw-collab-mode [data-testid='autosave-indicator'],
.excalidraw-collab-mode #app-save-action {
  display: none;
}
</style>
