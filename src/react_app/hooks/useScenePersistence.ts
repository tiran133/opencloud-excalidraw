import { useCallback, useEffect, useRef, useState } from 'react'
import { hashElementsVersion, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { BinaryFiles } from '@excalidraw/excalidraw/types'
import type { Socket } from 'socket.io-client'
import type { CollabManager } from '../CollabManager'

interface SceneSnapshot {
  data: string
  versionHash: number
}

const DEFAULT_AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

export function useScenePersistence(
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  onSave: ((data: string) => Promise<string | undefined> | void) | undefined,
  readOnly: boolean,
  isCollabMode: boolean,
  autoSaveIntervalMinutes?: number,
  socket?: Socket | null,
  roomId?: string,
  collabManagerRef?: React.RefObject<CollabManager | null>
) {
  const [isDirty, setIsDirty] = useState(false)
  const dirtyRef = useRef(false)
  const lastSavedVersionRef = useRef<number>(-1)
  const retryCountRef = useRef(0)
  const nextRetryAfterRef = useRef(0)
  const isSavingRef = useRef(false)
  const latestSceneSnapshotRef = useRef<SceneSnapshot | null>(null)

  const autoSaveIntervalMs = autoSaveIntervalMinutes
    ? autoSaveIntervalMinutes * 60 * 1000
    : DEFAULT_AUTOSAVE_INTERVAL_MS

  const setDirty = useCallback((value: boolean) => {
    dirtyRef.current = value
    setIsDirty(value)
  }, [])

  const triggerSave = useCallback(async () => {
    if (!excalidrawAPI || readOnly || !dirtyRef.current) return
    if (Date.now() < nextRetryAfterRef.current) return
    if (isSavingRef.current) return
    const elements = excalidrawAPI.getSceneElementsIncludingDeleted()
    const currentVersion = hashElementsVersion(elements)
    if (currentVersion === lastSavedVersionRef.current) {
      setDirty(false)
      return
    }
    const appState = excalidrawAPI.getAppState()
    const files = excalidrawAPI.getFiles()
    const data = serializeAsJSON(elements, appState, files, 'local')
    isSavingRef.current = true
    try {
      await onSave?.(data)
      retryCountRef.current = 0
      nextRetryAfterRef.current = 0
      setDirty(false)
      lastSavedVersionRef.current = currentVersion
      latestSceneSnapshotRef.current = null // clear snapshot after successful save
      // Broadcast save confirmation to peers so they can reset dirty if versions match
      if (socket?.connected && roomId) {
        socket.emit('save-confirmed', roomId, currentVersion)
      }
    } catch (err) {
      retryCountRef.current++
      const backoff = Math.min(1000 * Math.pow(2, retryCountRef.current), 60000)
      nextRetryAfterRef.current = Date.now() + backoff
      console.error(
        `[excalidraw] save failed (attempt ${retryCountRef.current}), next retry in ${backoff}ms`,
        err
      )
      setDirty(true)
    } finally {
      isSavingRef.current = false
    }
  }, [excalidrawAPI, onSave, readOnly, setDirty, socket, roomId])

  const lastKnownVersionRef = useRef<number>(-1)

  // Initialise version refs with the current scene hash once the API is ready,
  // so the first onChange doesn't incorrectly mark the scene as dirty.
  useEffect(() => {
    if (!excalidrawAPI) return
    const elements = excalidrawAPI.getSceneElementsIncludingDeleted()
    const version = hashElementsVersion(elements)
    if (lastKnownVersionRef.current === -1) {
      lastKnownVersionRef.current = version
    }
    if (lastSavedVersionRef.current === -1) {
      lastSavedVersionRef.current = version
    }
  }, [excalidrawAPI])

  /**
   * Only marks dirty if the element version actually changed.
   * Eagerly captures a serialized scene snapshot so that
   * save-on-disconnect can use it even after the Excalidraw API
   * is destroyed.
   */
  const markDirty = useCallback(
    (elements?: readonly any[], appState?: any, files?: BinaryFiles) => {
      if (!excalidrawAPI || lastKnownVersionRef.current === -1) return
      const els = elements ?? excalidrawAPI.getSceneElementsIncludingDeleted()
      const version = hashElementsVersion(els)
      if (version === lastKnownVersionRef.current) return
      lastKnownVersionRef.current = version

      // Eagerly serialize the scene for save-on-disconnect
      const as = appState ?? excalidrawAPI.getAppState()
      const fs = files ?? excalidrawAPI.getFiles()
      latestSceneSnapshotRef.current = {
        data: serializeAsJSON(els, as, fs, 'local'),
        versionHash: version
      }

      setDirty(true)
    },
    [excalidrawAPI, setDirty]
  )

  // Autosave interval for collab mode
  useEffect(() => {
    if (!isCollabMode || readOnly) return
    const intervalId = setInterval(() => {
      if (dirtyRef.current) {
        triggerSave()
      }
    }, autoSaveIntervalMs)
    return () => clearInterval(intervalId)
  }, [isCollabMode, readOnly, triggerSave, autoSaveIntervalMs])

  // Ctrl+S / Cmd+S handler for collab mode
  useEffect(() => {
    if (!isCollabMode || readOnly) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        triggerSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isCollabMode, readOnly, triggerSave])

  // Listen for save-confirmed from peers and reset dirty if version matches
  useEffect(() => {
    if (!socket || !isCollabMode) return
    const handleSaveConfirmed = (versionHash: number) => {
      if (!excalidrawAPI) return
      const elements = excalidrawAPI.getSceneElementsIncludingDeleted()
      const currentVersion = hashElementsVersion(elements)
      if (currentVersion === versionHash) {
        console.log('[excalidraw] peer saved, version matches — resetting dirty flag')
        lastSavedVersionRef.current = versionHash
        lastKnownVersionRef.current = versionHash
        setDirty(false)
      }
    }
    socket.on('save-confirmed', handleSaveConfirmed)
    return () => {
      socket.off('save-confirmed', handleSaveConfirmed)
    }
  }, [socket, isCollabMode, excalidrawAPI, setDirty])

  // beforeunload protection for collab mode
  useEffect(() => {
    if (!isCollabMode) return
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isCollabMode])

  const resetVersionRefs = useCallback(() => {
    if (!excalidrawAPI) return
    const elements = excalidrawAPI.getSceneElementsIncludingDeleted()
    const version = hashElementsVersion(elements)
    lastKnownVersionRef.current = version
    lastSavedVersionRef.current = version
    setDirty(false)
  }, [excalidrawAPI, setDirty])

  // Register a synchronous pre-disconnect hook on the CollabManager.
  // When disconnect() is called (from React cleanup), this fires while
  // the Excalidraw API and socket are still alive.
  useEffect(() => {
    const manager = collabManagerRef?.current
    if (!manager || !excalidrawAPI || readOnly || !isCollabMode) return

    manager.registerBeforeDisconnect(() => {
      if (!dirtyRef.current) return

      // Use the eagerly captured snapshot — by this point the Excalidraw API
      // may already be destroyed so we cannot query it.
      const snapshot = latestSceneSnapshotRef.current
      if (!snapshot) return
      if (snapshot.versionHash === lastSavedVersionRef.current) return

      // Emit save-confirmed NOW while the socket is still connected
      const sock = manager.getSocket()
      if (sock?.connected && roomId) {
        console.log('[excalidraw] save-on-disconnect, emitting save-confirmed')
        sock.emit('save-confirmed', roomId, snapshot.versionHash)
      }

      // Fire-and-forget the WebDAV PUT — the fetch continues even after
      // the component unmounts (SPA navigation doesn't cancel it)
      const result = onSave?.(snapshot.data)
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        ;(result as Promise<unknown>).catch((err: unknown) => {
          console.error('[excalidraw] save-on-disconnect failed:', err)
        })
      }

      latestSceneSnapshotRef.current = null
    })

    return () => {
      manager.registerBeforeDisconnect(null)
    }
  }, [collabManagerRef, excalidrawAPI, readOnly, isCollabMode, onSave, roomId])

  return {
    isDirty,
    dirtyRef,
    triggerSave,
    markDirty,
    resetVersionRefs
  }
}
