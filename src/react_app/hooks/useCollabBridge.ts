import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { CollabManager } from '../CollabManager'
import type { CollabState, PointerUpdatePayload } from '../CollabManager'
import type { Socket } from 'socket.io-client'

interface CollabBridgeProps {
  collabServerUrl?: string
  roomId?: string
  username: string
  readOnly: boolean
  isCollabMode: boolean
  langCode?: string
  accessToken?: string
  publicLinkToken?: string
  publicLinkPassword?: string
}

export function useCollabBridge(
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  apiReady: boolean,
  props: CollabBridgeProps
) {
  const collabManagerRef = useRef<CollabManager | null>(null)
  const [collabState, setCollabState] = useState<CollabState>('disconnected')
  const [collaboratorCount, setCollaboratorCount] = useState(0)
  const [nameChangeMessage, setNameChangeMessage] = useState<string | null>(null)
  const nameChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [collabSocket, setCollabSocket] = useState<Socket | null>(null)

  const {
    collabServerUrl,
    roomId,
    username,
    readOnly,
    isCollabMode,
    langCode,
    accessToken,
    publicLinkToken,
    publicLinkPassword
  } = props

  useEffect(() => {
    if (!apiReady || !excalidrawAPI || !collabServerUrl || !roomId || !isCollabMode) return

    const manager = new CollabManager({
      serverUrl: collabServerUrl,
      roomId,
      username,
      readOnly,
      isGuest: !!publicLinkToken,
      langCode,
      accessToken,
      publicLinkToken,
      publicLinkPassword,
      excalidrawAPI,
      onCollabStateChange: (state: CollabState) => {
        setCollabState(state)
      },
      onCollaboratorCountChange: (count: number) => {
        setCollaboratorCount(count)
      },
      onNameChange: (oldName: string, newName: string) => {
        if (nameChangeTimerRef.current) {
          clearTimeout(nameChangeTimerRef.current)
        }
        setNameChangeMessage(`${oldName} → ${newName}`)
        nameChangeTimerRef.current = setTimeout(() => {
          setNameChangeMessage(null)
          nameChangeTimerRef.current = null
        }, 5000)
      }
    })
    collabManagerRef.current = manager
    manager.connect()
    setCollabSocket(manager.getSocket())

    return () => {
      manager.disconnect()
      collabManagerRef.current = null
      setCollabSocket(null)
    }
    // Note: accessToken and username are intentionally excluded — token
    // refreshes and name changes should NOT tear down the WebSocket
    // connection.  They are updated in-place via separate effects below.
  }, [
    apiReady,
    collabServerUrl,
    roomId,
    readOnly,
    isCollabMode,
    langCode,
    publicLinkToken,
    publicLinkPassword,
    excalidrawAPI
  ])

  // Keep the username up-to-date on the existing manager without
  // tearing down the WebSocket connection.  This allows guests to
  // change their display name while staying connected.
  useEffect(() => {
    if (collabManagerRef.current) {
      collabManagerRef.current.updateUsername(username)
    }
  }, [username])

  // Keep the access token up-to-date on the existing manager without
  // tearing down the WebSocket connection.  This ensures that if the
  // socket needs to reconnect (e.g. network blip) it will use the
  // latest token for authentication.
  useEffect(() => {
    if (collabManagerRef.current) {
      collabManagerRef.current.updateAccessToken(accessToken)
    }
  }, [accessToken])

  const handlePointerUpdate = useCallback((payload: PointerUpdatePayload) => {
    if (collabManagerRef.current) {
      collabManagerRef.current.onPointerUpdate(payload)
    }
  }, [])

  return {
    collabManagerRef,
    collabState,
    collaboratorCount,
    nameChangeMessage,
    handlePointerUpdate,
    collabSocket
  }
}
