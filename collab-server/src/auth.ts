/**
 * Auth module – thin wrapper around authCore.ts.
 *
 * This file owns the runtime side-effects (process.env reads, setInterval
 * cache eviction, OIDC discovery with retry) and wires authCore's pure
 * functions to the real environment.
 */

import jwksClient from 'jwks-rsa'
import type { Socket } from 'socket.io'

import {
  createPublicLinkCache,
  evictExpiredEntries,
  discoverOIDC,
  oidcRetryDelay,
  verifyToken as coreVerifyToken,
  validatePublicLink as coreValidatePublicLink,
  processAuth,
  OIDC_MAX_RETRIES
} from './authCore.js'
import type { JWKSClient } from './authCore.js'

// ─── Environment ─────────────────────────────────────────────────────────────

const oidcIssuer = process.env.OIDC_ISSUER
if (!oidcIssuer) {
  console.warn('[auth] OIDC_ISSUER not set – all connections will be rejected')
}

const oidcAudience = process.env.OIDC_AUDIENCE || null

const ocUrl = process.env.OC_URL || oidcIssuer
if (!ocUrl) {
  console.warn('[auth] OC_URL not set – public link auth will not work')
}

// ─── Runtime state ───────────────────────────────────────────────────────────

let jwks: JWKSClient | null = null
let discoveredIssuer: string | null = null
let oidcRetryCount = 0

const publicLinkCache = createPublicLinkCache()

// Periodic eviction of expired cache entries (every 60s)
setInterval(() => evictExpiredEntries(publicLinkCache), 60_000)

// ─── OIDC discovery (with exponential backoff) ──────────────────────────────

async function initOIDC(): Promise<void> {
  if (!oidcIssuer) return
  console.log(`[auth] fetching OIDC discovery …`)
  try {
    const { issuer, jwksUri } = await discoverOIDC(oidcIssuer)
    discoveredIssuer = issuer
    console.log(`[auth] discovered issuer: ${discoveredIssuer}`)
    console.log(`[auth] discovered jwks_uri: ${jwksUri}`)
    jwks = jwksClient({
      jwksUri,
      cache: true,
      cacheMaxAge: 600_000,
      rateLimit: true,
      jwksRequestsPerMinute: 5
    }) as unknown as JWKSClient
  } catch (err) {
    oidcRetryCount++
    if (oidcRetryCount > OIDC_MAX_RETRIES) {
      console.error(
        `[auth] OIDC discovery failed after ${OIDC_MAX_RETRIES} retries — giving up. Server will reject all authenticated requests.`
      )
      return
    }
    const delay = oidcRetryDelay(oidcRetryCount)
    console.error(
      `[auth] OIDC discovery failed: ${(err as Error).message} — retry ${oidcRetryCount}/${OIDC_MAX_RETRIES} in ${delay / 1000}s`
    )
    setTimeout(initOIDC, delay)
  }
}

// ─── Socket.IO middleware ────────────────────────────────────────────────────

async function authMiddleware(socket: Socket, next: (err?: Error) => void): Promise<void> {
  const auth = socket.handshake.auth || {}

  try {
    const result = await processAuth(auth, {
      verifyTokenFn: (token) => coreVerifyToken(token, jwks, discoveredIssuer, oidcAudience),
      validatePublicLinkFn: (token, password) =>
        coreValidatePublicLink(token, password, {
          ocUrl,
          cache: publicLinkCache
        })
    })

    socket.data.user = result.user
    socket.data.authType = result.authType
    if (result.publicLinkToken) socket.data.publicLinkToken = result.publicLinkToken
    if (result.readOnly !== undefined) socket.data.readOnly = result.readOnly

    console.log(`[auth] authenticated via ${result.authType}`)
    return next()
  } catch (err) {
    console.warn(`[auth] rejected – ${(err as Error).message}`)
    return next(new Error((err as Error).message))
  }
}

function isOIDCReady(): boolean {
  return jwks !== null
}

export { initOIDC, authMiddleware, isOIDCReady }
