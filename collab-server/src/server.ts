import express from 'express'
import http from 'http'
import { Server as SocketIO } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import { initOIDC, authMiddleware, isOIDCReady } from './auth.js'
import { checkBroadcastRate, isValidRoomID, BROADCAST_RATE_LIMIT } from './validation.js'
import { isRedisConfigured, getRedisPub, getRedisSub, closeRedis } from './redis.js'

const app = express()
const port = process.env.PORT || 3002

// Optional path prefix for running behind a reverse proxy (e.g. "/collab")
const rawPrefix = process.env.PATH_PREFIX || ''
const pathPrefix = rawPrefix.endsWith('/') ? rawPrefix.slice(0, -1) : rawPrefix

// Connection rate limiting per IP: max 10 connections per 10 seconds
const connectionCounts = new Map<string, { count: number; timestamp: number }>()
const CONN_RATE_WINDOW_MS = 10_000
const CONN_RATE_MAX = 10

const router = express.Router()

router.get('/healthz', (_req, res) => {
  const oidcReady = isOIDCReady()
  const status = oidcReady ? 'ok' : 'degraded'
  res.status(oidcReady ? 200 : 503).json({ status, oidc: oidcReady ? 'ready' : 'unavailable' })
})

router.get('/', (_req, res) => {
  res.send('Excalidraw collaboration server is up :)')
})

app.use(pathPrefix || '/', router)

const server = http.createServer(app)

const corsOrigin = process.env.CORS_ORIGIN
if (!corsOrigin) {
  console.warn(
    '[config] CORS_ORIGIN not set – CORS will reject credentialed requests. Set CORS_ORIGIN to your frontend origin.'
  )
}

const io = new SocketIO(server, {
  transports: ['websocket', 'polling'],
  cors: {
    allowedHeaders: ['Content-Type', 'Authorization'],
    origin: corsOrigin || false,
    credentials: !!corsOrigin
  },
  maxHttpBufferSize: 10e6, // 10 MB
  path: pathPrefix ? `${pathPrefix}/socket.io` : '/socket.io'
})

// Conditionally attach Redis adapter for horizontal scaling
if (isRedisConfigured()) {
  const pubClient = getRedisPub()
  const subClient = getRedisSub()
  io.adapter(createAdapter(pubClient, subClient))
  console.log('[redis] Socket.IO Redis adapter attached — horizontal scaling enabled')
} else {
  console.log('[config] No Redis configured — using in-memory adapter (single instance only)')
}

// Initialize OIDC discovery & attach auth middleware
initOIDC()

// Connection rate limiting middleware
io.use((socket, next) => {
  const ip = socket.handshake.address
  const now = Date.now()
  let entry = connectionCounts.get(ip)
  if (!entry || now - entry.timestamp > CONN_RATE_WINDOW_MS) {
    entry = { count: 0, timestamp: now }
    connectionCounts.set(ip, entry)
  }
  entry.count++
  if (entry.count > CONN_RATE_MAX) {
    console.warn(`[rate-limit] connection rejected from ${ip} (${entry.count} in window)`)
    return next(new Error('Too many connections'))
  }
  next()
})

io.use(authMiddleware)

io.on('connection', (socket) => {
  console.log('[connect] new client connected')

  // Initialize per-socket rate limit state
  socket.data._broadcastTokens = BROADCAST_RATE_LIMIT
  socket.data._broadcastLastRefill = Date.now()

  io.to(socket.id).emit('init-room')

  socket.on('join-room', async (roomID: unknown, options?: { readOnly?: boolean }) => {
    if (!isValidRoomID(roomID)) {
      console.warn('[room] rejected invalid roomID')
      return
    }
    // Server-enforced readOnly (from auth, e.g. public link permissions) takes precedence
    const authReadOnly = !!socket.data.readOnly
    const clientReadOnly = !!(options && options.readOnly)
    const isReadOnly = authReadOnly || clientReadOnly
    socket.data.readOnly = isReadOnly
    console.log(`[join-room] client joined room (readOnly: ${isReadOnly})`)
    await socket.join(roomID)
    const sockets = await io.in(roomID).fetchSockets()
    if (sockets.length <= 1) {
      io.to(socket.id).emit('first-in-room')
    } else {
      socket.broadcast.to(roomID).emit('new-user', socket.id)
      // Ask existing users to re-announce their presence so the new user sees them
      socket.broadcast.to(roomID).emit('request-presence')
    }
    io.in(roomID).emit(
      'room-user-change',
      sockets.map((s) => s.id)
    )
  })

  socket.on('server-broadcast', (roomID: unknown, data: ArrayBuffer | string, iv: string) => {
    if (!isValidRoomID(roomID)) return
    if (!checkBroadcastRate(socket)) return
    if (socket.data.readOnly) {
      // Read-only clients may only send presence data (idle status, cursor).
      // Block if the payload looks like a scene update.
      try {
        const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8')
        const parsed = JSON.parse(text)
        if (parsed.type === 'SCENE_INIT' || parsed.type === 'SCENE_UPDATE') {
          console.warn('[broadcast] blocked scene update from read-only socket')
          return
        }
      } catch {
        // Can't verify payload from read-only client — block by default
        console.warn('[broadcast] blocked unparseable payload from read-only socket')
        return
      }
    }
    socket.broadcast.to(roomID).emit('client-broadcast', data, iv)
  })

  socket.on(
    'server-volatile-broadcast',
    (roomID: unknown, data: ArrayBuffer | string, iv: string) => {
      if (!isValidRoomID(roomID)) return
      if (!checkBroadcastRate(socket)) return
      if (socket.data.readOnly) {
        // Read-only clients may only send volatile presence data (cursor, idle).
        // Block if the payload looks like a scene update.
        try {
          const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8')
          const parsed = JSON.parse(text)
          if (parsed.type === 'SCENE_INIT' || parsed.type === 'SCENE_UPDATE') {
            console.warn('[broadcast] blocked scene update via volatile from read-only socket')
            return
          }
        } catch {
          // Can't verify payload from read-only client — block by default
          console.warn(
            '[broadcast] blocked unparseable volatile payload from read-only socket',
            data
          )
          return
        }
      }
      socket.volatile.broadcast.to(roomID).emit('client-broadcast', data, iv)
    }
  )

  socket.on('save-confirmed', (roomID: unknown, versionHash: unknown) => {
    if (!isValidRoomID(roomID)) return
    if (typeof versionHash !== 'number') return
    // Relay the save confirmation to all other clients in the room
    socket.broadcast.to(roomID).emit('save-confirmed', versionHash)
  })

  socket.on(
    'user-follow',
    async (payload: { action: string; userToFollow: { socketId: string } }) => {
      const roomID = `follow@${payload.userToFollow.socketId}`
      switch (payload.action) {
        case 'FOLLOW': {
          await socket.join(roomID)
          const sockets = await io.in(roomID).fetchSockets()
          io.to(payload.userToFollow.socketId).emit(
            'user-follow-room-change',
            sockets.map((s) => s.id)
          )
          break
        }
        case 'UNFOLLOW': {
          await socket.leave(roomID)
          const sockets = await io.in(roomID).fetchSockets()
          io.to(payload.userToFollow.socketId).emit(
            'user-follow-room-change',
            sockets.map((s) => s.id)
          )
          break
        }
      }
    }
  )

  socket.on('disconnecting', async () => {
    console.log('[disconnecting] client disconnecting')

    for (const roomID of Array.from(socket.rooms)) {
      const otherClients = (await io.in(roomID).fetchSockets()).filter((s) => s.id !== socket.id)
      const isFollowRoom = roomID.startsWith('follow@')
      if (!isFollowRoom && otherClients.length > 0) {
        socket.broadcast.to(roomID).emit(
          'room-user-change',
          otherClients.map((s) => s.id)
        )
      }
      if (isFollowRoom && otherClients.length === 0) {
        const socketId = roomID.replace('follow@', '')
        io.to(socketId).emit('broadcast-unfollow')
      }
    }
  })

  socket.on('disconnect', () => {
    socket.removeAllListeners()
  })
})

// Graceful shutdown
const shutdown = async (): Promise<void> => {
  console.log('[shutdown] closing server...')
  io.close()
  server.close()
  if (isRedisConfigured()) {
    await closeRedis()
  }
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

server.listen(port, () => {
  console.log(
    `Excalidraw collab server listening on port ${port}${pathPrefix ? `, path prefix: ${pathPrefix}` : ''}`
  )
})
