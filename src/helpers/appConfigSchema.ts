import { z } from 'zod'

export const appConfigSchema = z.object({
  collabServerEnabled: z.boolean().default(false),
  collabServerUrl: z.optional(z.union([z.literal(''), z.string().url()])),
  autoSaveIntervalMinutes: z.number().min(1).max(60).default(5)
})

export type AppConfig = z.infer<typeof appConfigSchema>
