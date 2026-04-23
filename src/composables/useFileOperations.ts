import { useClientService } from '@opencloud-eu/web-pkg'
import { urlJoin, buildWebDavPublicPath } from '@opencloud-eu/web-client'

interface PublicLinkAuth {
  publicLinkToken?: string
  publicLinkPassword?: string
}

function buildPublicLinkHeaders(auth: PublicLinkAuth): Record<string, string> {
  const headers: Record<string, string> = {}
  if (auth.publicLinkToken) {
    headers['public-token'] = auth.publicLinkToken
  }
  if (auth.publicLinkPassword) {
    headers['Authorization'] = 'Basic ' + btoa('public:' + auth.publicLinkPassword)
  }
  return headers
}

export function useFileOperations(publicLinkAuth?: PublicLinkAuth) {
  const clientService = useClientService()

  /**
   * Choose the right HTTP client and inject auth headers.
   * For public link users we must use httpUnAuthenticated + manual Basic auth,
   * because httpAuthenticated relies on a Bearer token which is undefined for
   * unauthenticated / public-link users.
   */
  const isPublicLink = !!(publicLinkAuth?.publicLinkToken || publicLinkAuth?.publicLinkPassword)
  const httpClient = isPublicLink
    ? clientService.httpUnAuthenticated
    : clientService.httpAuthenticated
  const extraHeaders = isPublicLink ? buildPublicLinkHeaders(publicLinkAuth!) : {}

  async function loadFile(fileUrl: string): Promise<string> {
    const response = await httpClient.get(fileUrl, {
      headers: { ...extraHeaders },
      responseType: 'text'
    })
    return response.data
  }

  async function saveFile(fileUrl: string, content: string): Promise<void> {
    await httpClient.put(fileUrl, content, {
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders
      }
    })
    console.log(`[excalidraw] Saved file`)
  }

  async function createFile(folderUrl: string, fileName: string): Promise<void> {
    const fileUrl = urlJoin(folderUrl, fileName)
    const emptyExcalidraw = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'opencloud-excalidraw',
      elements: [],
      appState: {
        viewBackgroundColor: '#ffffff'
      },
      files: {}
    })
    await saveFile(fileUrl, emptyExcalidraw)
  }

  let isSaving = false
  let pendingSave: { webDavPath: string; content: string } | null = null

  async function collabSave(webDavPath: string, content: string): Promise<void> {
    if (isSaving) {
      // Queue only the latest save request
      pendingSave = { webDavPath, content }
      return
    }
    isSaving = true
    try {
      if (!webDavPath) {
        console.error('[excalidraw] No webDavPath on resource, cannot save')
        return
      }
      let resolvedPath = webDavPath
      if (isPublicLink && publicLinkAuth?.publicLinkToken) {
        // For public links, resource.webDavPath is just the filename;
        // we need to prefix it with public-files/{token}
        resolvedPath = buildWebDavPublicPath(publicLinkAuth.publicLinkToken, webDavPath)
      }
      const davUrl = `/remote.php/dav/${resolvedPath.replace(/^\/+/, '')}`
      await saveFile(davUrl, content)
    } catch (e) {
      console.error('[excalidraw] collab save failed:', e)
      throw e
    } finally {
      isSaving = false
      // Drain any queued save
      if (pendingSave) {
        const next = pendingSave
        pendingSave = null
        await collabSave(next.webDavPath, next.content)
      }
    }
  }

  return {
    loadFile,
    saveFile,
    createFile,
    collabSave
  }
}
