/**
 * Pure / injectable authentication helpers.
 *
 * Every function that formerly relied on module-level state (jwks client,
 * process.env, global fetch, setInterval cache eviction) now accepts its
 * dependencies as explicit parameters so the logic can be unit-tested
 * without network access or side-effects.
 */

import { createHash } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { XMLParser } from 'fast-xml-parser'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OIDCDiscoveryResult {
  issuer: string
  jwksUri: string
}

export interface JWKSClient {
  getSigningKey(
    kid: string,
    cb: (err: Error | null, key?: { getPublicKey(): string }) => void
  ): void
}

export interface PublicLinkCacheEntry {
  result: { permissions: string }
  expiresAt: number
}

export type PublicLinkCache = Map<string, PublicLinkCacheEntry>

export interface ValidatePublicLinkDeps {
  ocUrl?: string
  cache?: PublicLinkCache
  fetchFn?: typeof fetch
}

export interface AuthResult {
  user: Record<string, unknown>
  authType: 'oidc' | 'publicLink'
  publicLinkToken?: string
  readOnly?: boolean
}

export interface ProcessAuthDeps {
  verifyTokenFn: (token: string) => Promise<Record<string, unknown>>
  validatePublicLinkFn: (token: string, password?: string) => Promise<{ permissions: string }>
}

export interface SocketAuth {
  token?: string
  publicLinkToken?: string
  publicLinkPassword?: string
  username?: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const FETCH_TIMEOUT_MS = 10_000
export const PUBLIC_LINK_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
export const PUBLIC_LINK_CACHE_MAX_SIZE = 1000
export const OIDC_MAX_RETRIES = 10
export const OIDC_BASE_DELAY = 5000

// ─── Cache helpers ───────────────────────────────────────────────────────────

/**
 * Create a new, independent public-link cache instance.
 * The cache is a plain Map so tests can inspect / pre-populate it easily.
 */
export function createPublicLinkCache(): PublicLinkCache {
  return new Map()
}

/**
 * Build a cache key from public-link token + password.
 */
export function cacheKey(publicLinkToken: string, publicLinkPassword = ''): string {
  return createHash('sha256').update(`${publicLinkToken}:${publicLinkPassword}`).digest('hex')
}

/**
 * Evict expired entries from a public-link cache (run on a timer in prod).
 */
export function evictExpiredEntries(cache: PublicLinkCache): void {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now > entry.expiresAt) {
      cache.delete(key)
    }
  }
}

// ─── OIDC discovery ──────────────────────────────────────────────────────────

/**
 * Fetch the OIDC discovery document and return { issuer, jwks_uri }.
 */
export async function discoverOIDC(
  oidcIssuer: string,
  fetchFn: typeof fetch = fetch
): Promise<OIDCDiscoveryResult> {
  const wellKnownUrl = `${oidcIssuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
  const res = await fetchFn(wellKnownUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const doc = (await res.json()) as { issuer: string; jwks_uri: string }
  return { issuer: doc.issuer, jwksUri: doc.jwks_uri }
}

/**
 * Compute the exponential-backoff delay for OIDC retries.
 */
export function oidcRetryDelay(retryCount: number): number {
  return Math.min(OIDC_BASE_DELAY * Math.pow(2, retryCount - 1), 60_000)
}

// ─── JWT verification ────────────────────────────────────────────────────────

/**
 * Retrieve the signing public key for the given JWT header.
 */
export function getSigningKey(
  jwksClient: JWKSClient | null,
  header: { kid: string }
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!jwksClient)
      return reject(new Error('JWKS client not initialised (OIDC discovery pending)'))
    jwksClient.getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err)
      resolve(key!.getPublicKey())
    })
  })
}

/**
 * Decode and cryptographically verify a JWT.
 */
export async function verifyToken(
  token: string,
  jwksClient: JWKSClient | null,
  discoveredIssuer: string | null,
  oidcAudience: string | null
): Promise<jwt.JwtPayload> {
  const decoded = jwt.decode(token, { complete: true })
  if (!decoded) throw new Error('invalid token format')

  const publicKey = await getSigningKey(jwksClient, decoded.header as { kid: string })

  const opts: jwt.VerifyOptions = discoveredIssuer ? { issuer: discoveredIssuer } : {}
  if (oidcAudience) opts.audience = oidcAudience

  return new Promise((resolve, reject) => {
    jwt.verify(token, publicKey, opts, (err, payload) => {
      if (err) return reject(err)
      resolve(payload as jwt.JwtPayload)
    })
  })
}

// ─── Public-link validation ──────────────────────────────────────────────────

/**
 * Build the Basic-auth header value for public-link PROPFIND requests.
 */
export function buildBasicAuth(password = ''): string {
  return Buffer.from(`public:${password}`).toString('base64')
}

/**
 * Build the PROPFIND XML body (static, but extracted for clarity).
 */
export function buildPropfindBody(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <oc:permissions/>
    <oc:name/>
  </d:prop>
</d:propfind>`
}

/**
 * Parse the permissions string from a PROPFIND 207 multi-status XML response.
 */
export function parsePermissionsFromPropfind(xml: string): string {
  const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true })
  const parsed = parser.parse(xml)

  let permissions = ''
  const responses = parsed?.multistatus?.response
  const list = Array.isArray(responses) ? responses : [responses]
  for (const entry of list) {
    const perm = entry?.propstat?.prop?.permissions
    if (typeof perm === 'string' && perm.length > 0) permissions = perm
  }
  return permissions
}

/**
 * Validate a public-link token by issuing a PROPFIND to OpenCloud's WebDAV.
 */
export async function validatePublicLink(
  publicLinkToken: unknown,
  publicLinkPassword = '',
  { ocUrl, cache, fetchFn = fetch }: ValidatePublicLinkDeps = {}
): Promise<{ permissions: string }> {
  if (typeof publicLinkToken !== 'string' || !publicLinkToken) {
    throw new Error('invalid public link token')
  }

  // Check cache
  const key = cacheKey(publicLinkToken, publicLinkPassword)
  const cached = cache?.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result
  }

  if (!ocUrl) {
    throw new Error('OC_URL not configured – cannot validate public link')
  }

  const baseUrl = ocUrl.replace(/\/+$/, '')
  const propfindUrl = `${baseUrl}/remote.php/dav/public-files/${publicLinkToken}`
  const basicAuth = buildBasicAuth(publicLinkPassword)

  const res = await fetchFn(propfindUrl, {
    method: 'PROPFIND',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      Authorization: `Basic ${basicAuth}`,
      Depth: '1'
    },
    body: buildPropfindBody(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })

  if (res.status === 207) {
    const xml = await res.text()
    let permissions: string
    try {
      permissions = parsePermissionsFromPropfind(xml)
    } catch {
      throw new Error('failed to parse public link permissions')
    }
    const result = { permissions }

    // Store in cache (with eviction when full)
    if (cache) {
      if (cache.size >= PUBLIC_LINK_CACHE_MAX_SIZE) {
        const oldestKey = cache.keys().next().value
        if (oldestKey !== undefined) cache.delete(oldestKey)
      }
      cache.set(key, {
        result,
        expiresAt: Date.now() + PUBLIC_LINK_CACHE_TTL_MS
      })
    }

    return result
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error('invalid public link credentials')
  }

  throw new Error(`PROPFIND failed with HTTP ${res.status}`)
}

// ─── Socket.IO auth middleware (composable) ──────────────────────────────────

/**
 * Process socket authentication from the handshake.auth object.
 *
 * Returns an object describing the authenticated identity, or throws on
 * failure. Separated from Socket.IO so it can be tested with plain objects.
 */
export async function processAuth(
  auth: unknown,
  { verifyTokenFn, validatePublicLinkFn }: ProcessAuthDeps
): Promise<AuthResult> {
  if (!auth || typeof auth !== 'object') {
    throw new Error('authentication required')
  }

  const authObj = auth as SocketAuth

  // Mode 1: OIDC JWT
  if (authObj.token) {
    const payload = await verifyTokenFn(authObj.token)
    return {
      user: payload,
      authType: 'oidc'
    }
  }

  // Mode 2: Public link
  if (authObj.publicLinkToken) {
    const result = await validatePublicLinkFn(authObj.publicLinkToken, authObj.publicLinkPassword)
    const isReadOnly = !result.permissions.includes('W')
    return {
      user: {
        sub: `public:${authObj.publicLinkToken}`,
        preferred_username: authObj.username || 'Guest',
        displayName: authObj.username || 'Guest'
      },
      authType: 'publicLink',
      publicLinkToken: authObj.publicLinkToken,
      readOnly: isReadOnly
    }
  }

  throw new Error('authentication required')
}
