import { Badge } from '@mantine/core'

/**
 * Visual confidence indicator for the review table. Thresholds match the
 * Sprint-2 spec exactly: ≥85 green, 60–84 amber, <60 red. The "needs review"
 * filter on TakeoffPage uses the same 85 threshold.
 */
export function ConfidenceChip({ confidence }: { confidence: number }) {
  const color = confidence >= 85 ? 'green' : confidence >= 60 ? 'yellow' : 'red'
  return (
    <Badge color={color} variant="light" radius="sm">
      {confidence}
    </Badge>
  )
}
