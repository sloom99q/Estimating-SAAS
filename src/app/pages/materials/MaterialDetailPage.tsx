import {
  Anchor,
  Box,
  Center,
  Group,
  Image,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { ArrowLeft, Warning } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { paths } from '@/app/router/paths'
import { useMaterials } from '@/features/materials'
import { MaterialProcurementPanel, useSuppliers } from '@/features/suppliers'
import { DirectionalIcon, EmptyState, Section } from '@/shared/ui'
import { formatCurrency, formatNumber } from '@/shared/utils/format'

/**
 * Composition root for the material detail / procurement view. Joins:
 *   - The materials feature → the material itself (hero panel)
 *   - The suppliers feature → MaterialProcurementPanel (cheapest / preferred
 *     / trend chips, comparison bars, snapshot timeline, add price action)
 *
 * Lives in app/ because materials + suppliers cannot import each other.
 */
export function MaterialDetailPage() {
  const { t } = useTranslation(['materials', 'suppliers'])
  const { materialId } = useParams<{ materialId: string }>()
  const { data: materials, isLoading } = useMaterials()
  const { data: suppliers } = useSuppliers()

  const material = useMemo(
    () => materials?.find((m) => m.id === materialId) ?? null,
    [materials, materialId],
  )

  if (isLoading) {
    return (
      <Center py={96}>
        <Loader />
      </Center>
    )
  }

  if (!material) {
    return (
      <Stack mt="xl">
        <EmptyState
          icon={Warning}
          title={t('materials:error')}
          description={t('materials:empty.description')}
        />
      </Stack>
    )
  }

  return (
    <Stack gap={36}>
      <Anchor
        component={Link}
        to={paths.materials}
        fz="sm"
        c="dimmed"
        underline="hover"
        w="fit-content"
      >
        <Group gap={6} wrap="nowrap">
          <DirectionalIcon icon={ArrowLeft} size={14} />
          <span>{t('materials:back')}</span>
        </Group>
      </Anchor>

      <Section
        title={material.name}
        description={t(`materials:categories.${material.category}`)}
        step="01"
      >
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
          <Box
            style={{
              gridColumn: 'span 1',
              borderRadius: 'var(--mantine-radius-md)',
              overflow: 'hidden',
              border: '1px solid var(--app-border)',
              aspectRatio: '4 / 3',
            }}
          >
            {material.imageUrl ? (
              <Image src={material.imageUrl} alt={material.name} h="100%" w="100%" fit="cover" />
            ) : (
              <Box
                style={{
                  width: '100%',
                  height: '100%',
                  background: 'var(--app-surface-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text fz="xs" c="dimmed">
                  {t('materials:preview.no_image')}
                </Text>
              </Box>
            )}
          </Box>

          <Box
            style={{
              gridColumn: 'span 2',
              background: 'var(--app-surface)',
              border: '1px solid var(--app-border)',
              borderRadius: 'var(--mantine-radius-md)',
              padding: 20,
            }}
          >
            <Stack gap="md">
              <Group gap="sm" align="baseline">
                <Title order={2} fz="h3" style={{ letterSpacing: '-0.02em' }}>
                  {formatCurrency(material.unitPrice, material.currency)}
                </Title>
                <Text fz="sm" c="dimmed">
                  / {t(`materials:units.${material.unit}`)}
                </Text>
              </Group>
              {material.supplier ? (
                <Text fz="sm" c="dimmed">
                  {t('suppliers:hero.originalSupplier', { name: material.supplier })}
                </Text>
              ) : null}

              <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="md">
                <Stat
                  label={t('materials:columns.coverage')}
                  value={`${formatNumber(material.coverage)} m² / ${t(`materials:units.${material.unit}`)}`}
                />
                <Stat
                  label={t('materials:columns.waste')}
                  value={`${formatNumber(material.wastePct)} %`}
                />
                <Stat label={t('materials:columns.status')}
                  value={
                    material.active
                      ? t('materials:status.active')
                      : t('materials:status.inactive')
                  }
                />
              </SimpleGrid>

              {material.notes ? (
                <Text fz="sm" c="dimmed">
                  {material.notes}
                </Text>
              ) : null}
            </Stack>
          </Box>
        </SimpleGrid>
      </Section>

      <MaterialProcurementPanel
        materialId={material.id}
        materialName={material.name}
        suppliers={suppliers ?? []}
      />
    </Stack>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={2}>
      <Text fz="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.04em' }}>
        {label}
      </Text>
      <Text className="app-numeric" fz="sm" fw={500}>
        {value}
      </Text>
    </Stack>
  )
}
