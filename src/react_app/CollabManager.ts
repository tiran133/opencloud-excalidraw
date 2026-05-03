import { io, Socket, Manager } from 'socket.io-client'
import {
  reconcileElements,
  hashElementsVersion,
  zoomToFitBounds,
  getVisibleSceneBounds
} from '@excalidraw/excalidraw'
import type {
  ExcalidrawImperativeAPI,
  Collaborator,
  AppState,
  BinaryFiles,
  SocketId
} from '@excalidraw/excalidraw/types'
import throttle from 'lodash.throttle'
import { translateExtensionLabel } from './i18n'

import {
  type ExtendedCollaborator,
  type PointerUpdatePayload,
  type CollabState,
  WS_SUBTYPES,
  buildCollaboratorMap,
  updateCollaboratorInMap,
  filterChangedElements,
  buildScenePayload,
  buildMousePayload,
  buildIdlePayload,
  parseBroadcast,
  shouldApplyViewportFollow
} from './collabState'
import { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile'
import { SceneBounds } from '@excalidraw/excalidraw/element/bounds'
import { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'

// Re-export for consumers
export type { CollabState, PointerUpdatePayload }

const CURSOR_SYNC_TIMEOUT = 33 // ~30fps, same as original
const SYNC_FULL_SCENE_INTERVAL_MS = 20000 // periodically resync full scene

// Reconnection defaults (exponential backoff)
const RECONNECT_DELAY_MS = 1000
const RECONNECT_DELAY_MAX_MS = 30000
const RECONNECT_ATTEMPTS = Infinity

interface CollabManagerOptions {
  serverUrl: string
  roomId: string
  username: string
  readOnly?: boolean
  isGuest?: boolean
  langCode?: string
  accessToken?: string
  publicLinkToken?: string
  publicLinkPassword?: string
  excalidrawAPI: ExcalidrawImperativeAPI
  onCollabStateChange?: (state: CollabState) => void
  onCollaboratorCountChange?: (count: number) => void
  onNameChange?: (oldName: string, newName: string) => void
}

export class CollabManager {
  private socket: Socket | null = null
  private roomId: string
  private serverUrl: string
  private username: string
  private excalidrawAPI: ExcalidrawImperativeAPI
  private broadcastedElementVersions: Map<string, number> = new Map()
  private lastBroadcastedOrReceivedSceneVersion = -1
  private onCollabStateChange?: (state: CollabState) => void
  private onCollaboratorCountChange?: (count: number) => void
  private onNameChange?: (oldName: string, newName: string) => void
  private destroyed = false
  private collaborators: Map<string, ExtendedCollaborator> = new Map()
  private socketInitialized = false
  private readOnly: boolean
  private isGuest: boolean
  private langCode?: string
  private accessToken?: string
  private publicLinkToken?: string
  private publicLinkPassword?: string
  private followedBy: Set<string> = new Set()
  private unsubOnUserFollow: (() => void) | null = null
  private unsubOnScrollChange: (() => void) | null = null
  private broadcastedFileIds: Set<string> = new Set()
  private beforeDisconnectFn: (() => void) | null = null
  private handleOnline: (() => void) | null = null
  private handleOffline: (() => void) | null = null

  constructor(options: CollabManagerOptions) {
    this.serverUrl = options.serverUrl
    this.roomId = options.roomId
    this.readOnly = options.readOnly ?? false
    this.isGuest = options.isGuest ?? false
    this.langCode = options.langCode
    this.accessToken = options.accessToken
    this.publicLinkToken = options.publicLinkToken
    this.publicLinkPassword = options.publicLinkPassword
    this.username = options.username
    this.excalidrawAPI = options.excalidrawAPI
    this.onCollabStateChange = options.onCollabStateChange
    this.onCollaboratorCountChange = options.onCollaboratorCountChange
    this.onNameChange = options.onNameChange
  }

  /** Expose the underlying socket so other hooks (e.g. save-confirmed) can listen/emit. */
  getSocket(): Socket | null {
    return this.socket
  }

  /**
   * Register a callback that fires synchronously at the start of disconnect(),
   * while the Excalidraw API and socket are still alive.
   */
  registerBeforeDisconnect(fn: (() => void) | null) {
    this.beforeDisconnectFn = fn
  }

  /** Get the translated "View Only" label for the current locale. */
  private get viewOnlyLabel(): string {
    return translateExtensionLabel(this.langCode, 'View Only')
  }

  /** Get the translated "Guest" label for the current locale. */
  private get guestLabel(): string {
    return translateExtensionLabel(this.langCode, 'Guest')
  }

  /**
   * Update the username without reconnecting.
   * Re-broadcasts presence so other collaborators see the new name.
   */
  updateUsername(newUsername: string) {
    this.username = newUsername
    if (this.socket?.connected && this.socketInitialized) {
      this.broadcastIdleStatus(true)
    }
  }

  /**
   * Update the stored access token without reconnecting.
   * The new token will be used for any future reconnection attempts.
   */
  updateAccessToken(token: string | undefined) {
    this.accessToken = token
    // Update the auth payload on the existing socket manager so that
    // any automatic reconnection attempts use the fresh token.
    if (this.socket && this.accessToken) {
      this.socket.auth = { token: this.accessToken }
    }
  }

  connect() {
    if (this.socket || this.destroyed) return

    this.onCollabStateChange?.('connecting')

    // Extract origin and path from serverUrl
    let socketOrigin = this.serverUrl
    let socketPath = '/socket.io'
    try {
      const url = new URL(this.serverUrl)
      socketOrigin = url.origin
      if (url.pathname && url.pathname !== '/') {
        const base = url.pathname.replace(/\/+$/, '')
        socketPath = `${base}/socket.io`
      }
    } catch {
      // fallback to default
    }
    // Build auth payload: OIDC token or public link credentials
    let authPayload: Record<string, string> | undefined
    if (this.accessToken) {
      authPayload = { token: this.accessToken }
    } else if (this.publicLinkToken) {
      authPayload = {
        publicLinkToken: this.publicLinkToken,
        ...(this.publicLinkPassword && { publicLinkPassword: this.publicLinkPassword }),
        username: this.username
      }
    }

    this.socket = io(socketOrigin, {
      path: socketPath,
      transports: ['websocket', 'polling'],
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: RECONNECT_ATTEMPTS,
      reconnectionDelay: RECONNECT_DELAY_MS,
      reconnectionDelayMax: RECONNECT_DELAY_MAX_MS,
      randomizationFactor: 0.3,
      auth: authPayload
    })

    this.socket.on('connect', () => {
      console.log('[excalidraw-collab] connected')
    })

    this.socket.on('disconnect', (reason) => {
      console.log(`[excalidraw-collab] disconnected (reason: ${reason})`)
      this.socketInitialized = false
      this.collaborators = new Map()
      this.excalidrawAPI.updateScene({ collaborators: new Map() })
      // If the socket will attempt to reconnect, show 'reconnecting' instead of 'disconnected'
      if (this.socket?.active) {
        this.onCollabStateChange?.('reconnecting')
      } else {
        this.onCollabStateChange?.('disconnected')
      }
    })

    // Reconnection events are emitted on the Manager (socket.io), not the Socket
    this.socket.io.on('reconnect_attempt', (attempt: number) => {
      console.log(`[excalidraw-collab] reconnect attempt #${attempt}`)
      this.onCollabStateChange?.('reconnecting')
    })

    this.socket.io.on('reconnect', (attempt: number) => {
      console.log(`[excalidraw-collab] reconnected after ${attempt} attempt(s)`)
      // The server will re-emit 'init-room' on reconnect, which triggers
      // join-room → first-in-room / room-user-change → 'connected' state.
    })

    this.socket.io.on('reconnect_error', (err: Error) => {
      console.warn('[excalidraw-collab] reconnect error:', err.message)
    })

    this.socket.io.on('reconnect_failed', () => {
      console.error('[excalidraw-collab] reconnect failed after maximum attempts')
      this.onCollabStateChange?.('disconnected')
    })

    this.socket.on('connect_error', (err: Error) => {
      console.warn('[excalidraw-collab] connect error:', err.message)
    })

    // ─── Browser online/offline detection ─────────────────────────────
    // When the browser goes offline, stop reconnection attempts (they
    // will all fail anyway and just grow the backoff timer).  When the
    // browser comes back online, force an immediate reconnect so the
    // user doesn't have to wait for the (potentially huge) backoff.
    this.handleOffline = () => {
      if (!this.socket || this.destroyed) return
      console.log('[excalidraw-collab] browser went offline — pausing reconnection')
      this.onCollabStateChange?.('offline')
      // Disconnect the manager so socket.io stops its internal retry
      // timer.  We'll reconnect manually when the network returns.
      this.socket.io.reconnection(false)
    }

    this.handleOnline = () => {
      if (!this.socket || this.destroyed) return
      console.log('[excalidraw-collab] browser came back online — reconnecting immediately')
      this.onCollabStateChange?.('reconnecting')
      // Re-enable reconnection and force an immediate attempt.
      this.socket.io.reconnection(true)
      // Reset the backoff so we don't wait up to 30 s for the first try.
      ;(this.socket.io as Manager)._reconnecting = false
      if (!this.socket.connected) {
        this.socket.connect()
      }
    }

    window.addEventListener('online', this.handleOnline)
    window.addEventListener('offline', this.handleOffline)

    this.socket.on('init-room', () => {
      console.log('[excalidraw-collab] init-room, joining', this.roomId)
      this.socket?.emit('join-room', this.roomId, { readOnly: this.readOnly })
    })

    this.socket.on('first-in-room', () => {
      console.log('[excalidraw-collab] first in room')
      this.socketInitialized = true
      this.onCollabStateChange?.('connected')
      this.broadcastIdleStatus()
      this.initFollowMode()
    })

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.socket.on('new-user', (_socketId: string) => {
      console.log('[excalidraw-collab] new user joined, broadcasting full scene')
      // Send full scene to the new user
      const elements = this.excalidrawAPI.getSceneElementsIncludingDeleted()
      this.broadcastScene(WS_SUBTYPES.INIT, elements, true)
    })

    this.socket.on('room-user-change', (clients: string[]) => {
      console.log(`[excalidraw-collab] room users: ${clients.length} client(s)`)
      this.setCollaborators(clients)
      if (!this.socketInitialized) {
        this.socketInitialized = true
        this.onCollabStateChange?.('connected')
        this.broadcastIdleStatus()
        this.initFollowMode()
      }
    })

    // Receive broadcasts from other clients
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.socket.on('client-broadcast', (data: ArrayBuffer | string, _iv: unknown) => {
      this.handleRemoteBroadcast(data)
    })

    // When a new user joins, the server asks existing users to re-announce presence
    // Use reliable broadcast so the new user is guaranteed to receive it
    this.socket.on('request-presence', () => {
      this.broadcastIdleStatus(true)
    })
  }

  private setCollaborators(socketIds: string[]) {
    this.collaborators = buildCollaboratorMap({
      socketIds,
      mySocketId: this.socket?.id,
      myUsername: this.username,
      myReadOnly: this.readOnly,
      myIsGuest: this.isGuest,
      existing: this.collaborators,
      viewOnlyLabel: this.viewOnlyLabel,
      guestLabel: this.guestLabel
    })
    this.excalidrawAPI.updateScene({
      collaborators: this.collaborators as Map<SocketId, Collaborator>
    })
    this.onCollaboratorCountChange?.(this.collaborators.size)
  }

  private updateCollaborator(
    socketId: string,
    updates: Partial<ExtendedCollaborator>,
    remoteReadOnly?: boolean,
    remoteIsGuest?: boolean
  ) {
    // Detect username changes from remote collaborators
    const isMe = socketId === this.socket?.id
    if (!isMe && updates.username) {
      const existing = this.collaborators.get(socketId)
      const oldRaw = existing?._rawUsername
      if (oldRaw && oldRaw !== updates.username) {
        this.onNameChange?.(oldRaw, updates.username)
      }
    }

    this.collaborators = updateCollaboratorInMap({
      socketId,
      updates,
      remoteReadOnly,
      remoteIsGuest,
      mySocketId: this.socket?.id,
      myUsername: this.username,
      myReadOnly: this.readOnly,
      myIsGuest: this.isGuest,
      collaborators: this.collaborators,
      viewOnlyLabel: this.viewOnlyLabel,
      guestLabel: this.guestLabel
    })
    this.excalidrawAPI.updateScene({
      collaborators: this.collaborators as Map<SocketId, Collaborator>
    })
  }

  private handleRemoteBroadcast(rawData: ArrayBuffer | string) {
    const decoded = parseBroadcast(rawData)
    if (!decoded) {
      console.error('[excalidraw-collab] failed to parse remote broadcast')
      return
    }

    switch (decoded.type) {
      case WS_SUBTYPES.INIT:
      case WS_SUBTYPES.UPDATE: {
        const remoteElements = decoded.payload.elements as RemoteExcalidrawElement[]
        if (!remoteElements?.length) return

        const localElements = this.excalidrawAPI.getSceneElementsIncludingDeleted()
        const appState = this.excalidrawAPI.getAppState()

        const reconciledElements = reconcileElements(localElements, remoteElements, appState)

        this.excalidrawAPI.updateScene({
          elements: reconciledElements
        })

        // If the broadcast includes image files, register them so image
        // elements can render instead of showing a placeholder.
        const remoteFiles = decoded.payload.files as BinaryFiles | undefined
        if (remoteFiles && Object.keys(remoteFiles).length > 0) {
          this.excalidrawAPI.addFiles(Object.values(remoteFiles))
          // Track these file IDs so we don't re-broadcast them back
          for (const fileId of Object.keys(remoteFiles)) {
            this.broadcastedFileIds.add(fileId)
          }
        }

        // Update version tracking
        this.lastBroadcastedOrReceivedSceneVersion = hashElementsVersion(reconciledElements)
        break
      }
      case WS_SUBTYPES.MOUSE_LOCATION: {
        const {
          socketId,
          pointer,
          button,
          username,
          selectedElementIds,
          isReadOnly: remoteReadOnly,
          isGuest: remoteIsGuest
        } = decoded.payload
        this.updateCollaborator(
          socketId,
          {
            pointer: pointer as Collaborator['pointer'],
            button: button as Collaborator['button'],
            selectedElementIds: selectedElementIds as AppState['selectedElementIds'],
            username
          },
          remoteReadOnly,
          remoteIsGuest
        )
        break
      }
      case WS_SUBTYPES.IDLE_STATUS: {
        const {
          socketId,
          userState,
          username,
          isReadOnly: remoteReadOnly,
          isGuest: remoteIsGuest
        } = decoded.payload
        this.updateCollaborator(
          socketId,
          {
            userState: userState as Collaborator['userState'],
            username
          },
          remoteReadOnly,
          remoteIsGuest
        )
        break
      }
      case WS_SUBTYPES.USER_VISIBLE_SCENE_BOUNDS: {
        const { sceneBounds, socketId } = decoded.payload
        const appState = this.excalidrawAPI.getAppState()

        const userToFollow = (appState as AppState & { userToFollow?: { socketId: string } })
          .userToFollow

        if (!shouldApplyViewportFollow(socketId, userToFollow?.socketId, this.followedBy)) {
          break
        }

        this.excalidrawAPI.updateScene({
          appState: zoomToFitBounds({
            appState,
            bounds: sceneBounds as SceneBounds,
            fitToViewport: true,
            viewportZoomFactor: 1
          }).appState
        })
        break
      }
    }
  }

  /**
   * Called by ExcalidrawWrapper on onChange — broadcasts local changes to peers.
   */
  broadcastElements(elements: readonly OrderedExcalidrawElement[]) {
    if (!this.socket?.connected || !this.socketInitialized) return

    const sceneVersion = hashElementsVersion(elements)
    if (sceneVersion === this.lastBroadcastedOrReceivedSceneVersion) return
    this.lastBroadcastedOrReceivedSceneVersion = sceneVersion

    this.broadcastScene(WS_SUBTYPES.UPDATE, elements, false)
    this.queueBroadcastAllElements()
  }

  // Periodically resync full scene to recover from dropped messages
  private queueBroadcastAllElements = throttle(() => {
    if (!this.socket?.connected || !this.socketInitialized) return
    // Reset broadcastedFileIds so the full resync also re-sends image files,
    // ensuring peers that missed them can recover.
    this.broadcastedFileIds.clear()
    const elements = this.excalidrawAPI.getSceneElementsIncludingDeleted()
    this.broadcastScene(WS_SUBTYPES.UPDATE, elements, true)
  }, SYNC_FULL_SCENE_INTERVAL_MS)

  private broadcastScene(
    updateType: typeof WS_SUBTYPES.INIT | typeof WS_SUBTYPES.UPDATE,
    elements: readonly OrderedExcalidrawElement[],
    syncAll: boolean
  ) {
    if (!this.socket?.connected) return

    const { toSend, updatedVersions } = filterChangedElements(
      elements,
      this.broadcastedElementVersions,
      syncAll
    )

    if (toSend.length === 0) return
    this.broadcastedElementVersions = updatedVersions

    // Collect any new image files referenced by the elements being sent
    const newFiles = this.getNewFiles(toSend)

    const data = buildScenePayload(updateType, toSend, newFiles)
    const encoded = new TextEncoder().encode(data)

    this.socket.emit(
      'server-broadcast',
      this.roomId,
      encoded.buffer,
      new Uint8Array(0) // no encryption — key exchange not feasible without shared link mechanism
    )
  }

  /**
   * Return a map of files referenced by the given elements that have not
   * yet been broadcast.  After calling this method the returned file IDs
   * are marked as broadcast so they won't be sent again.
   */
  private getNewFiles(elements: readonly { id: string }[]): Record<string, unknown> | undefined {
    const allFiles = this.excalidrawAPI.getFiles()
    if (!allFiles || Object.keys(allFiles).length === 0) return undefined

    // Collect fileIds referenced by elements in this batch
    const referencedFileIds = new Set<string>()
    for (const el of elements) {
      const fileId = (el as unknown as { fileId?: string }).fileId
      if (fileId) referencedFileIds.add(fileId)
    }

    const newFiles: Record<string, unknown> = {}
    for (const fileId of referencedFileIds) {
      if (!this.broadcastedFileIds.has(fileId) && allFiles[fileId]) {
        newFiles[fileId] = allFiles[fileId]
        this.broadcastedFileIds.add(fileId)
      }
    }

    return Object.keys(newFiles).length > 0 ? newFiles : undefined
  }

  /**
   * Broadcast mouse pointer position (volatile — ok to drop).
   * Called from Excalidraw's onPointerUpdate prop.
   */
  onPointerUpdate = throttle((payload: PointerUpdatePayload) => {
    if (!this.socket?.connected || !this.socket.id || !this.socketInitialized) return
    if (payload.pointersMap.size >= 2) return // ignore multi-touch

    const data = buildMousePayload(
      this.socket.id,
      payload.pointer,
      payload.button || 'up',
      this.excalidrawAPI.getAppState().selectedElementIds,
      this.username,
      this.readOnly,
      this.isGuest
    )

    const encoded = new TextEncoder().encode(data)
    this.socket.emit('server-volatile-broadcast', this.roomId, encoded.buffer, new Uint8Array(0))
  }, CURSOR_SYNC_TIMEOUT)

  /**
   * Broadcast idle/presence status so other users know we're here.
   * For read-only users this is the primary way to announce presence.
   */
  private broadcastIdleStatus(reliable = false) {
    if (!this.socket?.connected || !this.socket.id || !this.socketInitialized) return

    const data = buildIdlePayload(this.socket.id, this.username, this.readOnly, this.isGuest)
    const encoded = new TextEncoder().encode(data)
    this.socket.emit(
      reliable ? 'server-broadcast' : 'server-volatile-broadcast',
      this.roomId,
      encoded.buffer,
      new Uint8Array(0)
    )
  }

  /**
   * Initialize follow mode: listen for user-follow events from Excalidraw UI
   * and relay viewport bounds when being followed.
   */
  private initFollowMode() {
    if (!this.socket) return

    // When Excalidraw's UI triggers follow/unfollow, relay to server
    this.unsubOnUserFollow = this.excalidrawAPI.onUserFollow((payload) => {
      if (this.socket?.connected) {
        this.socket.emit('user-follow', payload)
      }
    })

    // When our viewport scrolls, broadcast bounds to followers
    this.unsubOnScrollChange = this.excalidrawAPI.onScrollChange(() => {
      this.relayVisibleSceneBounds()
    })

    // Server tells us who is following us
    this.socket.on('user-follow-room-change', (followedBy: string[]) => {
      this.followedBy = new Set(followedBy)
      this.excalidrawAPI.updateScene({
        appState: { followedBy: new Set(followedBy) as Set<SocketId> }
      })
      // Immediately send bounds so new follower syncs viewport
      this.relayVisibleSceneBounds({ force: true })
    })
  }

  /**
   * Broadcast our visible scene bounds to followers via a dedicated follow room.
   */
  private relayVisibleSceneBounds(opts?: { force: boolean }) {
    if (!this.socket?.connected || !this.socket.id) return

    const appState = this.excalidrawAPI.getAppState()
    if (this.followedBy.size === 0 && !opts?.force) return

    const sceneBounds = getVisibleSceneBounds(appState)

    const data = JSON.stringify({
      type: WS_SUBTYPES.USER_VISIBLE_SCENE_BOUNDS,
      payload: {
        socketId: this.socket.id,
        username: this.username,
        isReadOnly: this.readOnly,
        sceneBounds
      }
    })

    const encoded = new TextEncoder().encode(data)
    this.socket.emit(
      'server-volatile-broadcast',
      `follow@${this.socket.id}`,
      encoded.buffer,
      new Uint8Array(0)
    )
  }

  disconnect() {
    // Fire the pre-disconnect hook while API + socket are still alive
    try {
      this.beforeDisconnectFn?.()
    } catch (err) {
      console.error('[excalidraw] beforeDisconnect hook failed:', err)
    }
    this.beforeDisconnectFn = null
    this.destroyed = true
    this.queueBroadcastAllElements.cancel()
    this.onPointerUpdate.cancel()
    this.unsubOnUserFollow?.()
    this.unsubOnUserFollow = null
    this.unsubOnScrollChange?.()
    this.unsubOnScrollChange = null
    if (this.handleOnline) {
      window.removeEventListener('online', this.handleOnline)
      this.handleOnline = null
    }
    if (this.handleOffline) {
      window.removeEventListener('offline', this.handleOffline)
      this.handleOffline = null
    }
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }
    this.collaborators = new Map()
    this.followedBy = new Set()
    this.broadcastedElementVersions.clear()
    this.lastBroadcastedOrReceivedSceneVersion = -1
    this.socketInitialized = false
    this.onCollabStateChange?.('disconnected')
  }
}
