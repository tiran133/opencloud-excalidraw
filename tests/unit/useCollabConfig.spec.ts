import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { computed, ref } from 'vue'
import { useCollabConfig } from '../../src/composables/useCollabConfig'
import type { Resource } from '@opencloud-eu/web-client'
import type { AppConfig } from '../../src/helpers/appConfigSchema'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useSpacesStore: () => ({
    personalSpace: { storageId: 'personal-storage-id' }
  })
}))

function makeAppConfig(overrides: Partial<AppConfig> = {}) {
  return computed<AppConfig>(() => ({
    collabServerEnabled: false,
    collabServerUrl: undefined,
    ...overrides
  }))
}

function makeResource(overrides: Partial<Resource> = {}) {
  return computed<Resource>(
    () =>
      ({
        id: 'test-file-id',
        ...overrides
      }) as Resource
  )
}

describe('useCollabConfig', () => {
  let originalLocation: Location

  beforeEach(() => {
    originalLocation = window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        origin: 'https://cloud.example.com',
        search: '',
        href: 'https://cloud.example.com/app'
      }
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation
    })
  })

  describe('collabServerUrl', () => {
    it('uses the configured URL when provided', () => {
      const { collabServerUrl } = useCollabConfig(
        makeAppConfig({ collabServerUrl: 'https://custom-collab.example.com' }),
        makeResource()
      )
      expect(collabServerUrl.value).toBe('https://custom-collab.example.com')
    })

    it('falls back to window.location.origin + /excalidraw-collab/ when not configured', () => {
      const { collabServerUrl } = useCollabConfig(
        makeAppConfig({ collabServerUrl: undefined }),
        makeResource()
      )
      expect(collabServerUrl.value).toBe('https://cloud.example.com/excalidraw-collab/')
    })

    it('falls back when collabServerUrl is empty string', () => {
      const { collabServerUrl } = useCollabConfig(
        makeAppConfig({ collabServerUrl: '' }),
        makeResource()
      )
      expect(collabServerUrl.value).toBe('https://cloud.example.com/excalidraw-collab/')
    })
  })

  describe('roomId', () => {
    it('builds room ID from resource.id', () => {
      const { roomId } = useCollabConfig(makeAppConfig(), makeResource({ id: 'abc-123' }))
      expect(roomId.value).toBe('excalidraw:file:abc-123')
    })

    it('prefers fileId from URL query params over resource.id', () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { ...window.location, search: '?fileId=url-file-id' }
      })
      const { roomId } = useCollabConfig(makeAppConfig(), makeResource({ id: 'resource-id' }))
      expect(roomId.value).toBe('excalidraw:file:url-file-id')
    })

    it('returns undefined when neither fileId param nor resource.id exist', () => {
      const { roomId } = useCollabConfig(makeAppConfig(), makeResource({ id: undefined }))
      expect(roomId.value).toBeUndefined()
    })
  })

  describe('isCollabMode', () => {
    it('returns true when collab is enabled and URL + roomId are available', () => {
      const { isCollabMode } = useCollabConfig(
        makeAppConfig({ collabServerEnabled: true }),
        makeResource({ id: 'file-1' })
      )
      expect(isCollabMode.value).toBe(true)
    })

    it('returns false when collabServerEnabled is false', () => {
      const { isCollabMode } = useCollabConfig(
        makeAppConfig({ collabServerEnabled: false }),
        makeResource({ id: 'file-1' })
      )
      expect(isCollabMode.value).toBe(false)
    })

    it('returns false when roomId is undefined (no file)', () => {
      const { isCollabMode } = useCollabConfig(
        makeAppConfig({ collabServerEnabled: true }),
        makeResource({ id: undefined })
      )
      expect(isCollabMode.value).toBe(false)
    })
  })
})
