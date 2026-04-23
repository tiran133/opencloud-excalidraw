import { describe, expect, it } from 'vitest'
import { appConfigSchema } from '../../src/helpers/appConfigSchema'

describe('appConfigSchema', () => {
  it('applies defaults for an empty object', () => {
    const result = appConfigSchema.parse({})
    expect(result).toEqual({
      collabServerEnabled: false,
      collabServerUrl: undefined,
      autoSaveIntervalMinutes: 5
    })
  })

  it('parses a fully populated valid config', () => {
    const result = appConfigSchema.parse({
      collabServerEnabled: true,
      collabServerUrl: 'https://collab.example.com'
    })
    expect(result).toEqual({
      collabServerEnabled: true,
      collabServerUrl: 'https://collab.example.com',
      autoSaveIntervalMinutes: 5
    })
  })

  it('accepts an empty string for collabServerUrl', () => {
    const result = appConfigSchema.parse({
      collabServerEnabled: false,
      collabServerUrl: ''
    })
    expect(result.collabServerUrl).toBe('')
  })

  it('rejects an invalid URL for collabServerUrl', () => {
    const result = appConfigSchema.safeParse({
      collabServerEnabled: true,
      collabServerUrl: 'not-a-url'
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-boolean collabServerEnabled', () => {
    const result = appConfigSchema.safeParse({
      collabServerEnabled: 'yes'
    })
    expect(result.success).toBe(false)
  })

  it('allows collabServerUrl to be omitted', () => {
    const result = appConfigSchema.parse({ collabServerEnabled: true })
    expect(result.collabServerUrl).toBeUndefined()
  })
})
