import './excalidrawAssetPath' // Must be first — sets EXCALIDRAW_ASSET_PATH before Excalidraw loads
import { useCallback, useRef, useState } from 'react'
import {
  Excalidraw,
  MainMenu,
  serializeAsJSON,
  THEME
} from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import './ExcalidrawWrapper.css'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import PreferencesMenu from './components/PreferencesMenu'
import SaveButton from './components/SaveButton'
import CollabBadge from './components/CollabBadge'
import OfflineBanner from './components/OfflineBanner'
import NameChangeBanner from './components/NameChangeBanner'
import { useSceneLoader } from './hooks/useSceneLoader'
import { useScenePersistence } from './hooks/useScenePersistence'
import { useCollabBridge } from './hooks/useCollabBridge'
import { usePreferencesSync } from './hooks/usePreferencesSync'
import { translateExtensionLabel } from './i18n'
import { useHandleLibrary } from '@excalidraw/excalidraw'
import { get, set } from 'idb-keyval'
import { LibraryPersistenceAdapter } from '@excalidraw/excalidraw/data/library'

interface ExcalidrawWrapperProps {
  initialData?: string
  readOnly?: boolean
  onChange?: (data: string) => void
  onSave?: (data: string) => Promise<string | undefined> | void
  collabServerUrl?: string
  roomId?: string
  username?: string
  isDarkTheme?: boolean
  isCollabMode?: boolean
  langCode?: string
  accessToken?: string
  publicLinkToken?: string
  publicLinkPassword?: string
  onRequestNameChange?: () => void
  autoSaveIntervalMinutes?: number
}

const idbAdapter: LibraryPersistenceAdapter = {
  async load() {
    return (await get('excalidraw-library')) ?? null
  },
  async save(libraryData) {
    await set('excalidraw-library', libraryData)
  }
}

export default function ExcalidrawWrapper({
  initialData,
  readOnly = false,
  onChange,
  onSave,
  collabServerUrl,
  roomId,
  username = 'Anonymous',
  isDarkTheme = false,
  isCollabMode = false,
  langCode,
  accessToken,
  publicLinkToken,
  publicLinkPassword,
  onRequestNameChange,
  autoSaveIntervalMinutes
}: ExcalidrawWrapperProps) {
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const [apiReady, setApiReady] = useState(false)

  useHandleLibrary({
    excalidrawAPI: excalidrawAPIRef.current,
    adapter: idbAdapter,
    // Allow any library URL (default only allows excalidraw.com)
    validateLibraryUrl: () => true
  })

  const {
    collabManagerRef,
    collabState,
    collaboratorCount,
    nameChangeMessage,
    handlePointerUpdate,
    collabSocket
  } = useCollabBridge(excalidrawAPIRef.current, apiReady, {
    collabServerUrl,
    roomId,
    username,
    readOnly,
    isCollabMode,
    langCode,
    accessToken,
    publicLinkToken,
    publicLinkPassword
  })
  const { isDirty, dirtyRef, triggerSave, markDirty, resetVersionRefs } = useScenePersistence(
    excalidrawAPIRef.current,
    onSave,
    readOnly,
    isCollabMode,
    autoSaveIntervalMinutes,
    collabSocket,
    roomId,
    collabManagerRef
  )

  const { isInternalChange } = useSceneLoader(
    excalidrawAPIRef.current,
    apiReady,
    initialData,
    readOnly,
    isDarkTheme,
    resetVersionRefs
  )

  const { prefsState, syncPreferences } = usePreferencesSync(readOnly)

  const handleChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      if (!excalidrawAPIRef.current) return

      syncPreferences(appState)

      const collab = collabManagerRef.current

      // Broadcast to collab peers (even in readOnly so presence works, but not element changes)
      if (collab && !readOnly) {
        collab.broadcastElements(elements)
      }

      if (!readOnly) {
        if (isCollabMode) {
          markDirty(elements, appState, files)
        } else if (onChange) {
          // In single-user mode, call onChange to trigger framework save
          dirtyRef.current = true
          isInternalChange.current = true
          const data = serializeAsJSON(elements, appState, files, 'local')
          onChange(data)
        }
      }
    },
    [
      onChange,
      markDirty,
      readOnly,
      isCollabMode,
      syncPreferences,
      collabManagerRef,
      dirtyRef,
      isInternalChange
    ]
  )

  return (
    <div className="excalidraw" style={{ width: '100%', height: '100%', position: 'relative' }}>
      {isCollabMode && (collaboratorCount > 1 || collabState !== 'connected') && (
        <CollabBadge collabState={collabState} langCode={langCode} />
      )}
      {isCollabMode && collabState === 'offline' && <OfflineBanner langCode={langCode} />}
      {nameChangeMessage && <NameChangeBanner message={nameChangeMessage} langCode={langCode} />}
      <Excalidraw
        key={`excalidraw-${readOnly ? 'view' : 'edit'}`}
        theme={isDarkTheme ? THEME.DARK : THEME.LIGHT}
        langCode={langCode}
        excalidrawAPI={(api) => {
          excalidrawAPIRef.current = api
          setApiReady(true)
        }}
        renderTopRightUI={() => {
          return isCollabMode && !readOnly ? (
            <SaveButton isDirty={isDirty} onSave={triggerSave} />
          ) : null
        }}
        validateEmbeddable={false}
        onChange={handleChange}
        onPointerUpdate={handlePointerUpdate}
        viewModeEnabled={readOnly}
        isCollaborating={collabState === 'connected' && collaboratorCount > 1}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            export: readOnly ? false : {}
          }
        }}
      >
        <MainMenu>
          {!readOnly && <MainMenu.DefaultItems.Export />}
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          {!readOnly && <MainMenu.DefaultItems.ClearCanvas />}
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          {excalidrawAPIRef.current && (
            <PreferencesMenu
              excalidrawAPI={excalidrawAPIRef.current}
              prefsState={prefsState}
              readOnly={readOnly}
            />
          )}
          {!!publicLinkToken && onRequestNameChange && (
            <>
              <MainMenu.Separator />
              <MainMenu.ItemCustom>
                <button
                  className="change-name-trigger"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRequestNameChange()
                  }}
                >
                  <span className="change-name-trigger__label">
                    {translateExtensionLabel(langCode, 'Change name')}
                  </span>
                </button>
              </MainMenu.ItemCustom>
            </>
          )}
        </MainMenu>
      </Excalidraw>
    </div>
  )
}
