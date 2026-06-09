import { Box, Divider, Group, Stack, Table, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { formatCurrency, formatDate, formatNumber } from '@/shared/utils/format'
import type { QuotationDocument } from '../domain/quotation.types'

interface QuotationDocumentProps {
  document: QuotationDocument
}

/**
 * Client-facing quotation. Laid out as a single tall A4-style sheet — a
 * letterhead at the top, project meta, spaces breakdown, materials BOQ, and
 * a tight totals block. Designed so `window.print()` produces a clean
 * document; the `quotation-sheet` class is also targeted by `global.css`
 * print rules so navigation, sidebars and buttons disappear when printing.
 */
export function QuotationDocumentView({ document }: QuotationDocumentProps) {
  return (
    <Box
      className="quotation-sheet"
      style={{
        background: 'var(--app-surface)',
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--mantine-radius-lg)',
        padding: 48,
        maxWidth: 920,
        margin: '0 auto',
      }}
    >
      <Stack gap={36}>
        <Letterhead document={document} />

        <Divider color="var(--app-border)" />

        <ProjectMeta document={document} />

        <SpacesBreakdown document={document} />

        <MaterialsBreakdown document={document} />

        <Totals document={document} />

        <Footer document={document} />
      </Stack>
    </Box>
  )
}

function Letterhead({ document }: { document: QuotationDocument }) {
  const { t } = useTranslation(['quotations', 'common'])
  return (
    <Group justify="space-between" align="flex-start">
      <Stack gap={2}>
        <Text
          fz="xs"
          c="dimmed"
          fw={600}
          tt="uppercase"
          style={{ letterSpacing: '0.12em' }}
        >
          {t('common:app.name')}
        </Text>
        <Title order={1} fz={28} fw={500} style={{ letterSpacing: '-0.02em' }}>
          {t('quotations:document.title')}
        </Title>
      </Stack>
      <Stack gap={2} align="flex-end">
        <Text
          className="app-numeric"
          fz="sm"
          fw={600}
          style={{ letterSpacing: '0.06em' }}
        >
          {document.reference}
        </Text>
        <Text className="app-numeric" fz="xs" c="dimmed">
          {t('quotations:document.issued', { date: formatDate(document.issuedAt) })}
        </Text>
        <Text className="app-numeric" fz="xs" c="dimmed">
          {t('quotations:document.validUntil', {
            date: formatDate(document.validUntil),
          })}
        </Text>
      </Stack>
    </Group>
  )
}

function ProjectMeta({ document }: { document: QuotationDocument }) {
  const { t } = useTranslation(['quotations', 'projects'])
  const { project } = document
  return (
    <Group justify="space-between" align="flex-start" wrap="wrap" gap="xl">
      <Stack gap={4}>
        <Text fz="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.08em' }}>
          {t('quotations:document.preparedFor')}
        </Text>
        <Text fz="lg" fw={500}>
          {project.clientName}
        </Text>
        <Text fz="sm" c="dimmed">
          {project.location}
        </Text>
      </Stack>
      <Stack gap={4} align="flex-end">
        <Text fz="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.08em' }}>
          {t('quotations:document.project')}
        </Text>
        <Text fz="lg" fw={500}>
          {project.name}
        </Text>
        <Text fz="sm" c="dimmed">
          {t(`projects:types.${project.type}`)}
        </Text>
      </Stack>
    </Group>
  )
}

function SpacesBreakdown({ document }: { document: QuotationDocument }) {
  const { t } = useTranslation(['quotations', 'spaces'])
  if (document.spaceLines.length === 0) return null
  return (
    <Stack gap="sm">
      <Text
        fz="xs"
        c="dimmed"
        fw={600}
        tt="uppercase"
        style={{ letterSpacing: '0.08em' }}
      >
        {t('quotations:document.spacesBreakdown')}
      </Text>
      <Table verticalSpacing="xs" horizontalSpacing="md">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('spaces:columns.name')}</Table.Th>
            <Table.Th>{t('spaces:columns.dimensions')}</Table.Th>
            <Table.Th ta="end">{t('spaces:columns.floor')}</Table.Th>
            <Table.Th ta="end">{t('spaces:columns.walls')}</Table.Th>
            <Table.Th ta="end">{t('spaces:columns.ceiling')}</Table.Th>
            <Table.Th ta="end">{t('quotations:document.subtotal')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {document.spaceLines.map((space) => (
            <Table.Tr key={space.id}>
              <Table.Td>
                <Text fz="sm" fw={500}>
                  {space.name}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text className="app-numeric" fz="sm" c="dimmed">
                  {formatNumber(space.dimensions.length)} ×{' '}
                  {formatNumber(space.dimensions.width)} ×{' '}
                  {formatNumber(space.dimensions.height)} m
                </Text>
              </Table.Td>
              <Table.Td ta="end">
                <Text className="app-numeric" fz="sm">
                  {formatNumber(space.floorArea)} m²
                </Text>
              </Table.Td>
              <Table.Td ta="end">
                <Text className="app-numeric" fz="sm">
                  {formatNumber(space.wallArea)} m²
                </Text>
              </Table.Td>
              <Table.Td ta="end">
                <Text className="app-numeric" fz="sm">
                  {formatNumber(space.ceilingArea)} m²
                </Text>
              </Table.Td>
              <Table.Td ta="end">
                <Text className="app-numeric" fz="sm" fw={500}>
                  {formatCurrency(Number(space.amount), document.totals.currency, {
                    maximumFractionDigits: 0,
                  })}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}

function MaterialsBreakdown({ document }: { document: QuotationDocument }) {
  const { t } = useTranslation(['quotations', 'materials'])
  if (document.materialLines.length === 0) return null
  return (
    <Stack gap="sm">
      <Text
        fz="xs"
        c="dimmed"
        fw={600}
        tt="uppercase"
        style={{ letterSpacing: '0.08em' }}
      >
        {t('quotations:document.materialsBreakdown')}
      </Text>
      <Table verticalSpacing="xs" horizontalSpacing="md">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('materials:boq.columns.material')}</Table.Th>
            <Table.Th>{t('materials:boq.columns.category')}</Table.Th>
            <Table.Th ta="end">{t('materials:boq.columns.totalArea')}</Table.Th>
            <Table.Th ta="end">{t('materials:boq.columns.quantity')}</Table.Th>
            <Table.Th ta="end">{t('materials:boq.columns.unitPrice')}</Table.Th>
            <Table.Th ta="end">{t('materials:boq.columns.totalCost')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {document.materialLines.map((line) => (
            <Table.Tr key={line.materialId}>
              <Table.Td>
                <Text fz="sm" fw={500}>
                  {line.materialName}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text fz="sm" c="dimmed">
                  {t(`materials:categories.${line.category}`)}
                </Text>
              </Table.Td>
              <Table.Td ta="end">
                <Text className="app-numeric" fz="sm">
                  {formatNumber(line.totalArea)} m²
                </Text>
              </Table.Td>
              <Table.Td ta="end">
                <Text className="app-numeric" fz="sm">
                  {formatNumber(line.quantity)} {t(`materials:units.${line.unit}`)}
                </Text>
              </Table.Td>
              <Table.Td ta="end">
                <Text className="app-numeric" fz="sm" c="dimmed">
                  {formatCurrency(line.unitPrice, document.totals.currency)}
                </Text>
              </Table.Td>
              <Table.Td ta="end">
                <Text className="app-numeric" fz="sm" fw={500}>
                  {formatCurrency(Number(line.amount), document.totals.currency, {
                    maximumFractionDigits: 0,
                  })}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}

function Totals({ document }: { document: QuotationDocument }) {
  const { t } = useTranslation(['quotations', 'materials'])
  const { totals } = document
  return (
    <Stack gap="xs" align="flex-end" style={{ width: '100%' }}>
      {document.categoryTotals.length > 0 ? (
        <Stack gap={4} style={{ width: '100%', maxWidth: 360 }}>
          {document.categoryTotals.map((category) => (
            <Group key={category.category} justify="space-between">
              <Text fz="sm" c="dimmed">
                {t(`materials:categories.${category.category}`)}
              </Text>
              <Text className="app-numeric" fz="sm">
                {formatCurrency(Number(category.amount), totals.currency, {
                  maximumFractionDigits: 0,
                })}
              </Text>
            </Group>
          ))}
          <Divider my={4} color="var(--app-border)" />
        </Stack>
      ) : null}
      <Stack gap={4} style={{ width: '100%', maxWidth: 360 }}>
        <Group justify="space-between">
          <Text fz="sm" c="dimmed">
            {t('quotations:document.subtotal')}
          </Text>
          <Text className="app-numeric" fz="sm">
            {formatCurrency(Number(totals.subtotal), totals.currency, {
              maximumFractionDigits: 0,
            })}
          </Text>
        </Group>
        <Group justify="space-between">
          <Text fz="sm" c="dimmed">
            {t('quotations:document.tax', { rate: formatNumber(totals.taxRate) })}
          </Text>
          <Text className="app-numeric" fz="sm">
            {formatCurrency(Number(totals.taxAmount), totals.currency, {
              maximumFractionDigits: 0,
            })}
          </Text>
        </Group>
        <Divider color="var(--app-border)" />
        <Group justify="space-between" mt={4}>
          <Text fz="sm" fw={600}>
            {t('quotations:document.grandTotal')}
          </Text>
          <Text className="app-numeric" fz={20} fw={600}>
            {formatCurrency(Number(totals.grandTotal), totals.currency, {
              maximumFractionDigits: 0,
            })}
          </Text>
        </Group>
      </Stack>
    </Stack>
  )
}

function Footer({ document }: { document: QuotationDocument }) {
  const { t } = useTranslation(['quotations'])
  return (
    <Stack gap={4} mt="lg">
      <Divider color="var(--app-border)" />
      <Group justify="space-between" wrap="wrap">
        <Text fz="xs" c="dimmed">
          {t('quotations:document.terms')}
        </Text>
        <Text className="app-numeric" fz="xs" c="dimmed">
          {document.reference}
        </Text>
      </Group>
      {document.unassignedSurfaceArea > 0 ? (
        <Text fz="xs" c="dimmed">
          {t('quotations:document.unassignedNote', {
            area: formatNumber(document.unassignedSurfaceArea),
          })}
        </Text>
      ) : null}
    </Stack>
  )
}
