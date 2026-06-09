import { Group, Text } from '@mantine/core'

interface LogoProps {
  /** Hide the wordmark, show only the mark (e.g. collapsed nav). */
  showWordmark?: boolean
  size?: number
}

/**
 * Brand mark + wordmark. The mark is a single, simple geometric glyph — a dark
 * tile with a "peak/measure" stroke and one accent point — evoking measurement
 * and estimation. Uses theme color variables so it adapts to light/dark.
 */
export function Logo({ showWordmark = true, size = 26 }: LogoProps) {
  return (
    <Group gap="xs" wrap="nowrap" align="center">
      <svg
        viewBox="0 0 32 32"
        width={size}
        height={size}
        style={{ flexShrink: 0 }}
        role="img"
        aria-label="Estimator"
      >
        <rect x="2" y="2" width="28" height="28" rx="7" fill="var(--mantine-color-ink-8)" />
        <path
          d="M8 22 L15 11 L24 22"
          stroke="var(--mantine-color-white)"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="15" cy="11" r="1.9" fill="var(--mantine-color-warn-4)" />
      </svg>
      {showWordmark ? (
        <Text fw={700} fz="lg" style={{ letterSpacing: '-0.02em' }}>
          Estimator
        </Text>
      ) : null}
    </Group>
  )
}
