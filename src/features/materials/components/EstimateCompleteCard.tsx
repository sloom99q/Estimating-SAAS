import { Box, Button, Group, Stack, Text } from '@mantine/core'
import { ArrowRight, CheckCircle } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { DirectionalIcon } from '@/shared/ui'
import { formatCurrency } from '@/shared/utils/format'
import type { ProjectBoq } from '../domain/boq'

interface EstimateCompleteCardProps {
  boq: ProjectBoq
  /** Where the "Open quotation" CTA navigates. */
  quotationHref: string
}

/**
 * Phase-7 "moment of value". Appears once `boq.fullyAssigned === true` to
 * tell the user the estimate is ready and surface a single, unambiguous next
 * step: open the quotation. Tasteful success accent on the marker only — the
 * card itself stays in the editorial palette so it doesn't read as a banner.
 */
export function EstimateCompleteCard({
  boq,
  quotationHref,
}: EstimateCompleteCardProps) {
  const { t } = useTranslation(['materials'])
  return (
    <Box
      style={{
        background: 'var(--app-surface)',
        border: '1px solid var(--mantine-color-success-light)',
        borderRadius: 'var(--mantine-radius-md)',
        padding: 20,
      }}
    >
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="md" wrap="nowrap" align="center">
          <Box
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'var(--mantine-color-success-light)',
              color: 'var(--mantine-color-success-filled)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <CheckCircle size={22} weight="fill" />
          </Box>
          <Stack gap={2}>
            <Text fz="md" fw={600}>
              {t('materials:complete.title')}
            </Text>
            <Text fz="sm" c="dimmed">
              {t('materials:complete.body', {
                total: formatCurrency(Number(boq.grandTotal), boq.currency, {
                  maximumFractionDigits: 0,
                }),
              })}
            </Text>
          </Stack>
        </Group>
        <Button
          component={Link}
          to={quotationHref}
          rightSection={<DirectionalIcon icon={ArrowRight} size={14} />}
        >
          {t('materials:complete.cta')}
        </Button>
      </Group>
    </Box>
  )
}
