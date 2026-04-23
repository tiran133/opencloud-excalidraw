<script setup lang="ts">
import { applyReactInVue } from 'veaury'
import { createRoot } from 'react-dom/client'
import ExcalidrawWrapper from '../react_app/ExcalidrawWrapper'

const props = defineProps<{
  initialData?: string
  readOnly?: boolean
  collabServerUrl?: string
  roomId?: string
  username?: string
  isCollabMode?: boolean
  isDarkTheme?: boolean
  langCode?: string
  accessToken?: string
  publicLinkToken?: string
  publicLinkPassword?: string
  onRequestNameChange?: () => void
  onSave?: (data: string) => void | Promise<void>
  autoSaveIntervalMinutes?: number
}>()

const emit = defineEmits<{
  change: [data: string]
}>()

const ReactExcalidraw = applyReactInVue(ExcalidrawWrapper, {
  react: {
    createRoot
  }
})

function handleChange(data: string) {
  emit('change', data)
}
</script>

<template>
  <div class="excalidraw-editor">
    <!-- eslint-disable vue/attribute-hyphenation -->
    <ReactExcalidraw
      :initialData="initialData"
      :readOnly="readOnly"
      :collabServerUrl="collabServerUrl"
      :roomId="roomId"
      :username="username"
      :isDarkTheme="isDarkTheme"
      :isCollabMode="isCollabMode"
      :langCode="langCode"
      :accessToken="accessToken"
      :publicLinkToken="publicLinkToken"
      :publicLinkPassword="publicLinkPassword"
      :onRequestNameChange="props.onRequestNameChange"
      :onSave="props.onSave"
      :autoSaveIntervalMinutes="props.autoSaveIntervalMinutes"
      :onChange="handleChange"
    />
  </div>
</template>

<style scoped>
.excalidraw-editor {
  width: 100%;
  height: 100%;
}
</style>
