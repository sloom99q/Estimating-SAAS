import { z } from 'zod'
import type { Translate } from '@/shared/types'
import type { SpaceInput } from './space.types'

const MAX_HORIZONTAL_M = 200
const MAX_VERTICAL_M = 20

/**
 * Pure space form schema factory. Mirrors the live-preview constraints — values
 * must be positive, finite, and within sensible building envelopes (so a fat
 * finger doesn't compute 1km² of floor).
 */
export function createSpaceSchema(t: Translate) {
  const horizontal = (positiveKey: string, maxKey: string) =>
    z
      .number({ message: t(positiveKey) })
      .finite(t(positiveKey))
      .gt(0, t(positiveKey))
      .max(MAX_HORIZONTAL_M, t(maxKey))

  return z.object({
    name: z.string().trim().min(1, t('spaces:validation.nameRequired')),
    length: horizontal('spaces:validation.lengthPositive', 'spaces:validation.lengthMax'),
    width: horizontal('spaces:validation.widthPositive', 'spaces:validation.widthMax'),
    height: z
      .number({ message: t('spaces:validation.heightPositive') })
      .finite(t('spaces:validation.heightPositive'))
      .gt(0, t('spaces:validation.heightPositive'))
      .max(MAX_VERTICAL_M, t('spaces:validation.heightMax')),
  })
}

// Type alias so the shape is `Record<string, unknown>`-compatible.
export type SpaceFormValues = SpaceInput
