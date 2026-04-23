import { describe, expect, it, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'

import {
  FETCH_TIMEOUT_MS,
  PUBLIC_LINK_CACHE_TTL_MS,
  PUBLIC_LINK_CACHE_MAX_SIZE,
  OIDC_MAX_RETRIES,
  OIDC_BASE_DELAY,
  createPublicLinkCache,
  cacheKey,
  evictExpiredEntries,
  discoverOIDC,
  oidcRetryDelay,
  getSigningKey,
  verifyToken,
  buildBasicAuth,
  buildPropfindBody,
  parsePermissionsFromPropfind,
  validatePublicLink,
  processAuth
} from '../src/authCore.js'
import type { JWKSClient, PublicLinkCacheEntry } from '../src/authCore.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate an RSA key pair for JWT signing tests */
function generateKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
}

/** Create a signed JWT using a given private key */
function signToken(payload: object, privateKey: string, kid = 'test-kid'): string {
  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    keyid: kid,
    expiresIn: '1h'
  })
}

/** Build a fake JWKS client that returns the given public key for any kid */
function fakeJwksClient(publicKey: string): JWKSClient {
  return {
    getSigningKey: (
      _kid: string,
      cb: (err: Error | null, key?: { getPublicKey(): string }) => void
    ) => {
      cb(null, { getPublicKey: () => publicKey })
    }
  }
}

/** Minimal PROPFIND 207 response XML */
function propfindXml(permissions = 'RDNVW'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/public-files/abc123/</d:href>
    <d:propstat>
      <d:prop>
        <oc:permissions>${permissions}</oc:permissions>
        <oc:name>shared-file.excalidraw</oc:name>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`
}

/** Create a mock fetch that returns a canned response */
function mockFetch(status: number, body = '', json: unknown = null) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(json)
  }) as unknown as typeof fetch
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('exports expected default values', () => {
    expect(FETCH_TIMEOUT_MS).toBe(10_000)
    expect(PUBLIC_LINK_CACHE_TTL_MS).toBe(300_000)
    expect(PUBLIC_LINK_CACHE_MAX_SIZE).toBe(1000)
    expect(OIDC_MAX_RETRIES).toBe(10)
    expect(OIDC_BASE_DELAY).toBe(5000)
  })
})

// ─── Cache helpers ───────────────────────────────────────────────────────────

describe('createPublicLinkCache', () => {
  it('returns a new empty Map', () => {
    const cache = createPublicLinkCache()
    expect(cache).toBeInstanceOf(Map)
    expect(cache.size).toBe(0)
  })
})

describe('cacheKey', () => {
  it('produces a hex sha256 hash', () => {
    const key = cacheKey('token123', 'pass')
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs for different tokens', () => {
    expect(cacheKey('a', 'x')).not.toBe(cacheKey('b', 'x'))
  })

  it('differs for different passwords', () => {
    expect(cacheKey('a', 'x')).not.toBe(cacheKey('a', 'y'))
  })

  it('uses empty string as default password', () => {
    expect(cacheKey('tok')).toBe(cacheKey('tok', ''))
  })
})

describe('evictExpiredEntries', () => {
  it('removes entries whose expiresAt is in the past', () => {
    const cache = new Map<string, PublicLinkCacheEntry>([
      ['expired', { expiresAt: Date.now() - 1000, result: { permissions: '' } }],
      ['valid', { expiresAt: Date.now() + 60000, result: { permissions: '' } }]
    ])
    evictExpiredEntries(cache)
    expect(cache.has('expired')).toBe(false)
    expect(cache.has('valid')).toBe(true)
  })

  it('does nothing on an empty cache', () => {
    const cache = new Map<string, PublicLinkCacheEntry>()
    evictExpiredEntries(cache)
    expect(cache.size).toBe(0)
  })
})

// ─── OIDC discovery ──────────────────────────────────────────────────────────

describe('discoverOIDC', () => {
  it('fetches well-known URL and returns issuer + jwksUri', async () => {
    const fetchFn = mockFetch(200, '', {
      issuer: 'https://id.example.com',
      jwks_uri: 'https://id.example.com/.well-known/jwks.json'
    })

    const result = await discoverOIDC('https://id.example.com/', fetchFn)

    expect(result.issuer).toBe('https://id.example.com')
    expect(result.jwksUri).toBe('https://id.example.com/.well-known/jwks.json')
    // Verify URL construction (trailing slash stripped)
    expect(fetchFn).toHaveBeenCalledWith(
      'https://id.example.com/.well-known/openid-configuration',
      expect.objectContaining({ signal: expect.anything() })
    )
  })

  it('throws on non-OK response', async () => {
    const fetchFn = mockFetch(500)
    await expect(discoverOIDC('https://id.example.com', fetchFn)).rejects.toThrow('HTTP 500')
  })
})

describe('oidcRetryDelay', () => {
  it('uses exponential backoff starting from OIDC_BASE_DELAY', () => {
    expect(oidcRetryDelay(1)).toBe(OIDC_BASE_DELAY)
    expect(oidcRetryDelay(2)).toBe(OIDC_BASE_DELAY * 2)
    expect(oidcRetryDelay(3)).toBe(OIDC_BASE_DELAY * 4)
  })

  it('caps at 60 seconds', () => {
    expect(oidcRetryDelay(100)).toBe(60_000)
  })
})

// ─── JWT verification ────────────────────────────────────────────────────────

describe('getSigningKey', () => {
  it('rejects when jwksClient is null', async () => {
    await expect(getSigningKey(null, { kid: 'k1' })).rejects.toThrow('JWKS client not initialised')
  })

  it('resolves with the public key from the client', async () => {
    const client = fakeJwksClient('PEM-KEY-DATA')
    const key = await getSigningKey(client, { kid: 'k1' })
    expect(key).toBe('PEM-KEY-DATA')
  })

  it('rejects when getSigningKey callback returns an error', async () => {
    const client: JWKSClient = {
      getSigningKey: (
        _kid: string,
        cb: (err: Error | null, key?: { getPublicKey(): string }) => void
      ) => cb(new Error('key not found'))
    }
    await expect(getSigningKey(client, { kid: 'missing' })).rejects.toThrow('key not found')
  })
})

describe('verifyToken', () => {
  let privateKey: string
  let publicKey: string

  beforeEach(() => {
    const kp = generateKeyPair()
    privateKey = kp.privateKey
    publicKey = kp.publicKey
  })

  it('verifies a valid JWT and returns the payload', async () => {
    const token = signToken({ sub: 'user1', preferred_username: 'alice' }, privateKey)
    const client = fakeJwksClient(publicKey)
    const payload = await verifyToken(token, client, null, null)
    expect(payload.sub).toBe('user1')
    expect(payload.preferred_username).toBe('alice')
  })

  it('rejects a garbage token', async () => {
    await expect(verifyToken('not.a.token', fakeJwksClient(publicKey), null, null)).rejects.toThrow(
      'invalid token format'
    )
  })

  it('rejects an expired token', async () => {
    const token = jwt.sign({ sub: 'u' }, privateKey, {
      algorithm: 'RS256',
      keyid: 'k',
      expiresIn: '-10s'
    })
    const client = fakeJwksClient(publicKey)
    await expect(verifyToken(token, client, null, null)).rejects.toThrow(/expired/)
  })

  it('rejects when issuer does not match', async () => {
    const token = signToken({ sub: 'u', iss: 'https://wrong.com' }, privateKey)
    const client = fakeJwksClient(publicKey)
    await expect(verifyToken(token, client, 'https://correct.com', null)).rejects.toThrow(/issuer/)
  })

  it('validates audience when provided', async () => {
    const token = signToken({ sub: 'u', aud: 'wrong-aud' }, privateKey)
    const client = fakeJwksClient(publicKey)
    await expect(verifyToken(token, client, null, 'expected-aud')).rejects.toThrow(/audience/)
  })

  it('passes when audience matches', async () => {
    const token = signToken({ sub: 'u', aud: 'my-app' }, privateKey)
    const client = fakeJwksClient(publicKey)
    const payload = await verifyToken(token, client, null, 'my-app')
    expect(payload.sub).toBe('u')
  })
})

// ─── Public-link helpers ─────────────────────────────────────────────────────

describe('buildBasicAuth', () => {
  it('base64 encodes "public:<password>"', () => {
    const encoded = buildBasicAuth('secret')
    expect(Buffer.from(encoded, 'base64').toString()).toBe('public:secret')
  })

  it('defaults to empty password', () => {
    const encoded = buildBasicAuth()
    expect(Buffer.from(encoded, 'base64').toString()).toBe('public:')
  })
})

describe('buildPropfindBody', () => {
  it('returns valid XML containing oc:permissions and oc:name', () => {
    const body = buildPropfindBody()
    expect(body).toContain('oc:permissions')
    expect(body).toContain('oc:name')
    expect(body).toContain('<?xml')
  })
})

describe('parsePermissionsFromPropfind', () => {
  it('extracts permissions from a standard 207 response', () => {
    expect(parsePermissionsFromPropfind(propfindXml('RDNVW'))).toBe('RDNVW')
  })

  it('extracts read-only permissions', () => {
    expect(parsePermissionsFromPropfind(propfindXml('R'))).toBe('R')
  })

  it('returns empty string when no permissions element exists', () => {
    const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:propstat>
      <d:prop><oc:name>file.excalidraw</oc:name></d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`
    expect(parsePermissionsFromPropfind(xml)).toBe('')
  })

  it('handles multiple response entries and takes the last non-empty permission', () => {
    const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:propstat><d:prop><oc:permissions>R</oc:permissions></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:propstat><d:prop><oc:permissions>RDNVW</oc:permissions></d:prop></d:propstat>
  </d:response>
</d:multistatus>`
    expect(parsePermissionsFromPropfind(xml)).toBe('RDNVW')
  })
})

// ─── validatePublicLink ──────────────────────────────────────────────────────

describe('validatePublicLink', () => {
  const ocUrl = 'https://cloud.example.com'

  it('rejects non-string tokens', async () => {
    await expect(validatePublicLink(null)).rejects.toThrow('invalid public link token')
    await expect(validatePublicLink('')).rejects.toThrow('invalid public link token')
    await expect(validatePublicLink(123)).rejects.toThrow('invalid public link token')
  })

  it('throws when ocUrl is not configured', async () => {
    await expect(
      validatePublicLink('tok', '', { ocUrl: undefined, cache: new Map() })
    ).rejects.toThrow('OC_URL not configured')
  })

  it('returns permissions on a 207 response', async () => {
    const fetchFn = mockFetch(207, propfindXml('RDNVW'))
    const cache = new Map<string, PublicLinkCacheEntry>()
    const result = await validatePublicLink('tok123', '', { ocUrl, cache, fetchFn })
    expect(result).toEqual({ permissions: 'RDNVW' })
  })

  it('sends correct PROPFIND request', async () => {
    const fetchFn = mockFetch(207, propfindXml('R'))
    await validatePublicLink('mytoken', 'mypass', { ocUrl, cache: new Map(), fetchFn })

    expect(fetchFn).toHaveBeenCalledWith(
      'https://cloud.example.com/remote.php/dav/public-files/mytoken',
      expect.objectContaining({
        method: 'PROPFIND',
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('public:mypass').toString('base64')}`,
          Depth: '1'
        })
      })
    )
  })

  it('caches successful results', async () => {
    const fetchFn = mockFetch(207, propfindXml('R'))
    const cache = new Map<string, PublicLinkCacheEntry>()

    await validatePublicLink('tok', 'pw', { ocUrl, cache, fetchFn })
    expect(cache.size).toBe(1)

    // Second call should use cache, not fetch again
    ;(fetchFn as ReturnType<typeof vi.fn>).mockClear()
    const result = await validatePublicLink('tok', 'pw', { ocUrl, cache, fetchFn })
    expect(result).toEqual({ permissions: 'R' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('does not return stale cache entries', async () => {
    const cache = new Map<string, PublicLinkCacheEntry>()
    const key = cacheKey('tok', '')
    cache.set(key, { result: { permissions: 'OLD' }, expiresAt: Date.now() - 1 })

    const fetchFn = mockFetch(207, propfindXml('NEW'))
    const result = await validatePublicLink('tok', '', { ocUrl, cache, fetchFn })
    expect(result.permissions).toBe('NEW')
    expect(fetchFn).toHaveBeenCalled()
  })

  it('evicts oldest entry when cache is at max size', async () => {
    const cache = new Map<string, PublicLinkCacheEntry>()
    // Fill cache to capacity
    for (let i = 0; i < PUBLIC_LINK_CACHE_MAX_SIZE; i++) {
      cache.set(`key-${i}`, { result: { permissions: 'R' }, expiresAt: Date.now() + 60000 })
    }
    expect(cache.size).toBe(PUBLIC_LINK_CACHE_MAX_SIZE)

    const fetchFn = mockFetch(207, propfindXml('RW'))
    await validatePublicLink('new-token', '', { ocUrl, cache, fetchFn })

    // Size should not exceed max
    expect(cache.size).toBe(PUBLIC_LINK_CACHE_MAX_SIZE)
    // First entry should have been evicted
    expect(cache.has('key-0')).toBe(false)
  })

  it('throws on 401 response', async () => {
    const fetchFn = mockFetch(401)
    await expect(
      validatePublicLink('tok', '', { ocUrl, cache: new Map(), fetchFn })
    ).rejects.toThrow('invalid public link credentials')
  })

  it('throws on 403 response', async () => {
    const fetchFn = mockFetch(403)
    await expect(
      validatePublicLink('tok', '', { ocUrl, cache: new Map(), fetchFn })
    ).rejects.toThrow('invalid public link credentials')
  })

  it('throws on 500 response', async () => {
    const fetchFn = mockFetch(500)
    await expect(
      validatePublicLink('tok', '', { ocUrl, cache: new Map(), fetchFn })
    ).rejects.toThrow('PROPFIND failed with HTTP 500')
  })

  it('throws on 404 response', async () => {
    const fetchFn = mockFetch(404)
    await expect(
      validatePublicLink('tok', '', { ocUrl, cache: new Map(), fetchFn })
    ).rejects.toThrow('PROPFIND failed with HTTP 404')
  })
})

// ─── processAuth ─────────────────────────────────────────────────────────────

describe('processAuth', () => {
  const okVerify = vi.fn().mockResolvedValue({ sub: 'user1', preferred_username: 'alice' })
  const okPublicLink = vi.fn().mockResolvedValue({ permissions: 'RDNVW' })

  it('throws when auth is null', async () => {
    await expect(
      processAuth(null, { verifyTokenFn: okVerify, validatePublicLinkFn: okPublicLink })
    ).rejects.toThrow('authentication required')
  })

  it('throws when auth is not an object', async () => {
    await expect(
      processAuth('string', { verifyTokenFn: okVerify, validatePublicLinkFn: okPublicLink })
    ).rejects.toThrow('authentication required')
  })

  it('throws when no credentials are provided', async () => {
    await expect(
      processAuth({}, { verifyTokenFn: okVerify, validatePublicLinkFn: okPublicLink })
    ).rejects.toThrow('authentication required')
  })

  it('authenticates via OIDC when token is present', async () => {
    const result = await processAuth(
      { token: 'jwt-token' },
      { verifyTokenFn: okVerify, validatePublicLinkFn: okPublicLink }
    )
    expect(result.authType).toBe('oidc')
    expect(result.user.sub).toBe('user1')
    expect(okVerify).toHaveBeenCalledWith('jwt-token')
  })

  it('authenticates via public link when publicLinkToken is present', async () => {
    const result = await processAuth(
      { publicLinkToken: 'share-tok', publicLinkPassword: 'pw', username: 'Bob' },
      { verifyTokenFn: okVerify, validatePublicLinkFn: okPublicLink }
    )
    expect(result.authType).toBe('publicLink')
    expect(result.user.sub).toBe('public:share-tok')
    expect(result.user.preferred_username).toBe('Bob')
    expect(result.publicLinkToken).toBe('share-tok')
    expect(result.readOnly).toBe(false) // RDNVW includes W
  })

  it('sets readOnly=true when permissions lack W', async () => {
    const readOnlyLink = vi.fn().mockResolvedValue({ permissions: 'R' })
    const result = await processAuth(
      { publicLinkToken: 'share-tok' },
      { verifyTokenFn: okVerify, validatePublicLinkFn: readOnlyLink }
    )
    expect(result.readOnly).toBe(true)
  })

  it('uses "Guest" as default username for public links', async () => {
    const result = await processAuth(
      { publicLinkToken: 'share-tok' },
      { verifyTokenFn: okVerify, validatePublicLinkFn: okPublicLink }
    )
    expect(result.user.preferred_username).toBe('Guest')
    expect(result.user.displayName).toBe('Guest')
  })

  it('prefers OIDC token over public link when both are present', async () => {
    const result = await processAuth(
      { token: 'jwt', publicLinkToken: 'share' },
      { verifyTokenFn: okVerify, validatePublicLinkFn: okPublicLink }
    )
    expect(result.authType).toBe('oidc')
  })

  it('propagates verifyToken errors', async () => {
    const failVerify = vi.fn().mockRejectedValue(new Error('token expired'))
    await expect(
      processAuth(
        { token: 'bad' },
        { verifyTokenFn: failVerify, validatePublicLinkFn: okPublicLink }
      )
    ).rejects.toThrow('token expired')
  })

  it('propagates validatePublicLink errors', async () => {
    const failLink = vi.fn().mockRejectedValue(new Error('invalid public link credentials'))
    await expect(
      processAuth(
        { publicLinkToken: 'bad' },
        { verifyTokenFn: okVerify, validatePublicLinkFn: failLink }
      )
    ).rejects.toThrow('invalid public link credentials')
  })
})
