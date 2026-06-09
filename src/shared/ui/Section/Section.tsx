import { Box, Group, Stack, Text, Title } from '@mantine/core'
import type { ReactNode } from 'react'

/**
 * Standard page section — title, optional description, optional actions, body.
 * Encodes the spacing rhythm used across every Phase-2/3/4 page so future
 * sections don't drift into custom Stack/Group combinations.
 *
 * Layout rules baked in:
 *   - Section header → body gap: `md` (16px)
 *   - Title size: `h4` (matches existing "Spaces" / "Bill of quantities" /
 *     "Categories" headings — secondary headings, NOT page H1)
 *   - Description: 14px dimmed, sits under the title with a 2px gap
 *   - Body wraps in a Stack with consistent gap unless `flush` is true
 *
 * For PAGE-LEVEL headers (the H1 + project subtitle), keep using
 * `<PageHeader>`; this primitive is for the sections BELOW.
 *
 * Editorial `step` mode: pass `step="01"` to surface a big editorial number
 * prefix to the title — used inside the project workspace to communicate
 * "this is part of a flow, not a dashboard tile". The numeral renders in
 * tabular monospace at a heavier weight than the title so it reads as the
 * leading element without dominating it.
 */

export type SectionGap = 'sm' | 'md' | 'lg'

interface SectionProps {
  title: string
  description?: string | undefined
  actions?: ReactNode | undefined
  /** Optional editorial step prefix — e.g. "01" / "02". */
  step?: string | undefined
  /** Body content. Single child renders flush; multiple children stack. */
  children: ReactNode
  /** Body stack gap; defaults to `md`. */
  bodyGap?: SectionGap
  /** Overall vertical rhythm between sections. Caller-controlled. */
  gap?: SectionGap
}

const GAP_VALUE: Record<SectionGap, number> = {
  sm: 8,
  md: 16,
  lg: 24,
}

export function Section({
  title,
  description,
  actions,
  step,
  children,
  bodyGap = 'md',
  gap = 'md',
}: SectionProps) {
  return (
    <Stack gap={GAP_VALUE[gap]}>
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
        <Group gap="md" wrap="nowrap" align="flex-end">
          {step ? (
            <Box
              className="app-numeric"
              style={{
                fontSize: 28,
                lineHeight: 1,
                fontWeight: 500,
                color: 'var(--mantine-color-dimmed)',
                letterSpacing: '-0.04em',
                minWidth: 36,
              }}
              aria-hidden
            >
              {step}
            </Box>
          ) : null}
          <Stack gap={2}>
            <Title order={2} fz="h4">
              {title}
            </Title>
            {description ? (
              <Text fz="sm" c="dimmed">
                {description}
              </Text>
            ) : null}
          </Stack>
        </Group>
        {actions ? (
          <Group gap="sm" wrap="nowrap">
            {actions}
          </Group>
        ) : null}
      </Group>
      <Stack gap={GAP_VALUE[bodyGap]}>{children}</Stack>
    </Stack>
  )
}
