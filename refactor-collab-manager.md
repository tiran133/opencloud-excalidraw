# CollabManager Decomposition Plan

## Current state

`src/react_app/CollabManager.ts` — 578-line god object handling socket transport, auth, collaborator metadata, scene protocol, cursor/idle events, follow mode, save-leader state, avatars, and cleanup.

## Proposed split into 5 modules

### 1. `collab/protocol.ts` (~40 lines)

- `WS_SUBTYPES` constants
- `PointerUpdatePayload`, `CollabState`, `CollabManagerOptions` types
- Shared message type interfaces for all socket events (scene init/update, mouse location, idle status, visible bounds)

### 2. `collab/avatars.ts` (~50 lines)

- `hashToInteger()`, `getClientColor()`, `escapeSvg()`, `generateInitialsAvatarUrl()`
- Pure utility functions with no socket dependency

### 3. `collab/presence.ts` (~80 lines)

- `setCollaborators()`, `updateCollaborator()`, `displayName()`
- `broadcastIdleStatus()`
- Collaborator map management and avatar generation
- Imports from `avatars.ts` and `protocol.ts`

### 4. `collab/follow.ts` (~50 lines)

- `initFollowMode()`, `relayVisibleSceneBounds()`
- Follow/viewport sync logic

### 5. `CollabManager.ts` (~300 lines, down from 578)

- Constructor, `connect()`, `disconnect()`
- `handleRemoteBroadcast()`, `broadcastElements()`, `broadcastScene()`
- `onPointerUpdate()`
- Composes presence + follow modules via delegation

## Additional requirements (from review findings 17, 18)

### Typed protocol validation (Finding 17)

- Define typed message interfaces for every inbound/outbound socket event in `collab/protocol.ts`
- Add runtime validation (e.g. Zod schemas) for all incoming payloads in `handleRemoteBroadcast()`
- Replace manual JSON parsing and branching with validated, discriminated union types
- Ensure malformed messages are rejected explicitly instead of falling through silently

### Shared client/server protocol (Finding 18)

- Extract event names and message schemas into a shared package or module importable by both `src/react_app/` and `collab-server/`
- Remove duplicated raw event name strings and object shapes across the two codebases
- Consider a `shared/` directory at the repo root with protocol constants and Zod schemas

## Migration strategy

1. Extract `collab/avatars.ts` first — pure functions, zero risk.
2. Extract `collab/protocol.ts` — types and constants only.
3. Extract `collab/presence.ts` — requires passing socket + excalidrawAPI refs.
4. Extract `collab/follow.ts` — requires passing socket + excalidrawAPI refs.
5. Slim down `CollabManager.ts` to compose the above.
6. Verify no behavioral changes with manual collab testing.
