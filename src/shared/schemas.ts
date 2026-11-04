import { z } from 'zod'

export const pinSchema = z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits')

// Loose check here; the main process normalises and validates the exact format.
export const recoveryCodeInputSchema = z.string().min(1).max(64)

export const themeSchema = z.enum(['light', 'dark'])
