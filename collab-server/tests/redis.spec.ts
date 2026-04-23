import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { parseNodeList, resolveRedisMode, isRedisConfigured } from '../src/redis.js'

// ---------------------------------------------------------------------------
// parseNodeList
// ---------------------------------------------------------------------------
describe('parseNodeList', () => {
  const ENV = 'TEST_NODES'

  // --- valid inputs ---

  it('parses a single host:port entry', () => {
    expect(parseNodeList('redis-host:6379', ENV, 6379)).toEqual([
      { host: 'redis-host', port: 6379 }
    ])
  })

  it('parses multiple comma-separated entries', () => {
    expect(parseNodeList('host1:6379,host2:6380,host3:6381', ENV, 6379)).toEqual([
      { host: 'host1', port: 6379 },
      { host: 'host2', port: 6380 },
      { host: 'host3', port: 6381 }
    ])
  })

  it('uses the default port when port is omitted', () => {
    expect(parseNodeList('my-host', ENV, 26379)).toEqual([{ host: 'my-host', port: 26379 }])
  })

  it('trims whitespace around entries', () => {
    expect(parseNodeList('  host1:6379 , host2:6380 ', ENV, 6379)).toEqual([
      { host: 'host1', port: 6379 },
      { host: 'host2', port: 6380 }
    ])
  })

  it('ignores empty entries from trailing commas', () => {
    expect(parseNodeList('host1:6379,,host2:6380,', ENV, 6379)).toEqual([
      { host: 'host1', port: 6379 },
      { host: 'host2', port: 6380 }
    ])
  })

  it('parses IPv6 bracket notation with port', () => {
    expect(parseNodeList('[::1]:6379', ENV, 6379)).toEqual([{ host: '::1', port: 6379 }])
  })

  it('parses IPv6 bracket notation without port (uses default)', () => {
    expect(parseNodeList('[::1]', ENV, 6379)).toEqual([{ host: '::1', port: 6379 }])
  })

  it('parses full IPv6 bracket notation', () => {
    expect(parseNodeList('[2001:db8::1]:7000', ENV, 6379)).toEqual([
      { host: '2001:db8::1', port: 7000 }
    ])
  })

  it('parses bare IPv6 address without brackets (uses default port)', () => {
    expect(parseNodeList('::1', ENV, 6379)).toEqual([{ host: '::1', port: 6379 }])
  })

  it('parses a full bare IPv6 address', () => {
    expect(parseNodeList('2001:db8::1', ENV, 6379)).toEqual([{ host: '2001:db8::1', port: 6379 }])
  })

  it('parses mixed IPv4 and IPv6 entries', () => {
    expect(parseNodeList('redis1:6379,[::1]:6380,redis2', ENV, 6379)).toEqual([
      { host: 'redis1', port: 6379 },
      { host: '::1', port: 6380 },
      { host: 'redis2', port: 6379 }
    ])
  })

  it('accepts port 1 (minimum)', () => {
    expect(parseNodeList('host:1', ENV, 6379)).toEqual([{ host: 'host', port: 1 }])
  })

  it('accepts port 65535 (maximum)', () => {
    expect(parseNodeList('host:65535', ENV, 6379)).toEqual([{ host: 'host', port: 65535 }])
  })

  // --- invalid inputs ---

  it('throws on empty string', () => {
    expect(() => parseNodeList('', ENV, 6379)).toThrow('no valid entries')
  })

  it('throws on whitespace-only string', () => {
    expect(() => parseNodeList('   ', ENV, 6379)).toThrow('no valid entries')
  })

  it('throws on comma-only string', () => {
    expect(() => parseNodeList(',,,', ENV, 6379)).toThrow('no valid entries')
  })

  it('throws on missing closing bracket for IPv6', () => {
    expect(() => parseNodeList('[::1:6379', ENV, 6379)).toThrow('missing closing bracket')
  })

  it('throws on unexpected characters after IPv6 closing bracket', () => {
    expect(() => parseNodeList('[::1]garbage', ENV, 6379)).toThrow(
      'unexpected characters after IPv6 address'
    )
  })

  it('throws on non-numeric port', () => {
    expect(() => parseNodeList('host:abc', ENV, 6379)).toThrow(
      'port must be a number between 1 and 65535'
    )
  })

  it('throws on port 0', () => {
    expect(() => parseNodeList('host:0', ENV, 6379)).toThrow(
      'port must be a number between 1 and 65535'
    )
  })

  it('throws on port exceeding 65535', () => {
    expect(() => parseNodeList('host:65536', ENV, 6379)).toThrow(
      'port must be a number between 1 and 65535'
    )
  })

  it('throws on negative port', () => {
    expect(() => parseNodeList('host:-1', ENV, 6379)).toThrow(
      'port must be a number between 1 and 65535'
    )
  })

  it('throws on fractional port', () => {
    expect(() => parseNodeList('host:6379.5', ENV, 6379)).toThrow(
      'port must be a number between 1 and 65535'
    )
  })

  it('includes the env name in error messages', () => {
    expect(() => parseNodeList('', 'MY_ENV_VAR', 6379)).toThrow('MY_ENV_VAR')
  })

  it('throws when host is empty in host:port format', () => {
    expect(() => parseNodeList(':6379', ENV, 6379)).toThrow('host is missing')
  })
})

// ---------------------------------------------------------------------------
// resolveRedisMode
// ---------------------------------------------------------------------------
describe('resolveRedisMode', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear all Redis-related env vars before each test
    delete process.env.REDIS_URL
    delete process.env.REDIS_SENTINELS
    delete process.env.REDIS_CLUSTER_NODES
    delete process.env.REDIS_PASSWORD
    delete process.env.REDIS_SENTINEL_MASTER_NAME
    delete process.env.REDIS_SENTINEL_PASSWORD
    delete process.env.REDIS_SENTINEL_TLS
  })

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv }
  })

  it('returns standalone mode when only REDIS_URL is set', () => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    const result = resolveRedisMode()
    expect(result).toEqual({ mode: 'standalone', url: 'redis://localhost:6379' })
  })

  it('returns sentinel mode when REDIS_SENTINELS is set', () => {
    process.env.REDIS_SENTINELS = 'sentinel1:26379,sentinel2:26379'
    const result = resolveRedisMode()
    expect(result.mode).toBe('sentinel')
    if (result.mode === 'sentinel') {
      expect(result.sentinels).toEqual([
        { host: 'sentinel1', port: 26379 },
        { host: 'sentinel2', port: 26379 }
      ])
      expect(result.name).toBe('mymaster')
    }
  })

  it('uses custom sentinel master name when provided', () => {
    process.env.REDIS_SENTINELS = 'sentinel1:26379'
    process.env.REDIS_SENTINEL_MASTER_NAME = 'custom-master'
    const result = resolveRedisMode()
    if (result.mode === 'sentinel') {
      expect(result.name).toBe('custom-master')
    }
  })

  it('passes sentinel password when provided', () => {
    process.env.REDIS_SENTINELS = 'sentinel1:26379'
    process.env.REDIS_PASSWORD = 'secret'
    process.env.REDIS_SENTINEL_PASSWORD = 'sentinel-secret'
    const result = resolveRedisMode()
    if (result.mode === 'sentinel') {
      expect(result.password).toBe('secret')
      expect(result.sentinelPassword).toBe('sentinel-secret')
    }
  })

  it('enables TLS for sentinel when REDIS_SENTINEL_TLS is "true"', () => {
    process.env.REDIS_SENTINELS = 'sentinel1:26379'
    process.env.REDIS_SENTINEL_TLS = 'true'
    const result = resolveRedisMode()
    if (result.mode === 'sentinel') {
      expect(result.enableTLSForSentinelMode).toBe(true)
    }
  })

  it('disables TLS for sentinel by default', () => {
    process.env.REDIS_SENTINELS = 'sentinel1:26379'
    const result = resolveRedisMode()
    if (result.mode === 'sentinel') {
      expect(result.enableTLSForSentinelMode).toBe(false)
    }
  })

  it('returns cluster mode when REDIS_CLUSTER_NODES is set', () => {
    process.env.REDIS_CLUSTER_NODES = 'node1:7000,node2:7001,node3:7002'
    const result = resolveRedisMode()
    expect(result.mode).toBe('cluster')
    if (result.mode === 'cluster') {
      expect(result.nodes).toEqual([
        { host: 'node1', port: 7000 },
        { host: 'node2', port: 7001 },
        { host: 'node3', port: 7002 }
      ])
    }
  })

  it('passes cluster password when provided', () => {
    process.env.REDIS_CLUSTER_NODES = 'node1:7000'
    process.env.REDIS_PASSWORD = 'cluster-secret'
    const result = resolveRedisMode()
    if (result.mode === 'cluster') {
      expect(result.password).toBe('cluster-secret')
    }
  })

  it('prioritises cluster over sentinel', () => {
    process.env.REDIS_CLUSTER_NODES = 'node1:7000'
    process.env.REDIS_SENTINELS = 'sentinel1:26379'
    process.env.REDIS_URL = 'redis://localhost:6379'
    const result = resolveRedisMode()
    expect(result.mode).toBe('cluster')
  })

  it('prioritises sentinel over standalone', () => {
    process.env.REDIS_SENTINELS = 'sentinel1:26379'
    process.env.REDIS_URL = 'redis://localhost:6379'
    const result = resolveRedisMode()
    expect(result.mode).toBe('sentinel')
  })

  it('throws when no Redis env vars are set', () => {
    expect(() => resolveRedisMode()).toThrow(
      'REDIS_URL, REDIS_SENTINELS, or REDIS_CLUSTER_NODES must be set'
    )
  })
})

// ---------------------------------------------------------------------------
// isRedisConfigured
// ---------------------------------------------------------------------------
describe('isRedisConfigured', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.REDIS_URL
    delete process.env.REDIS_SENTINELS
    delete process.env.REDIS_CLUSTER_NODES
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns false when no Redis env vars are set', () => {
    expect(isRedisConfigured()).toBe(false)
  })

  it('returns true when REDIS_URL is set', () => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    expect(isRedisConfigured()).toBe(true)
  })

  it('returns true when REDIS_SENTINELS is set', () => {
    process.env.REDIS_SENTINELS = 'sentinel1:26379'
    expect(isRedisConfigured()).toBe(true)
  })

  it('returns true when REDIS_CLUSTER_NODES is set', () => {
    process.env.REDIS_CLUSTER_NODES = 'node1:7000'
    expect(isRedisConfigured()).toBe(true)
  })

  it('returns true when multiple Redis env vars are set', () => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.REDIS_SENTINELS = 'sentinel1:26379'
    expect(isRedisConfigured()).toBe(true)
  })
})
