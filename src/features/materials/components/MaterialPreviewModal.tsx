import { Box, Button, Group, Image, Modal, SimpleGrid, Stack, Text } from '@mantine/core'
import { PencilSimple, Trash } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { formatCurrency, formatNumber } from '@/shared/utils/format'
import { categoryVisual } from '../domain/category-visuals'
import type { Material } from '../domain/material.types'
import { CategoryIcon } from './CategoryIcon'
import { CategoryTexture } from './CategoryTexture'
import { MaterialCategoryBadge } from './MaterialCategoryBadge'

interface MaterialPreviewModalProps {
  material: Material | null
  opened: boolean
  onClose: () => void
  onEdit: (material: Material) => void
  onDelete: (material: Material) => void
}

/**
 * Material detail dialog: large image, category identity, all specs, and the
 * two primary actions. Reused from gallery card click and from the table row
 * (when the row is clicked rather than the kebab menu).
 */
export function MaterialPreviewModal({
  material,
  opened,
  onClose,
  onEdit,
  onDelete,
}: MaterialPreviewModalProps) {
  const { t } = useTranslation(['materials'])
  if (!material) return null

  const visual = categoryVisual(material.category)

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('materials:preview.openTitle')}
      centered
      size="xl"
      radius="md"
    >
      <Stack gap="lg">
        <Box
          style={{
            position: 'relative',
            aspectRatio: '16 / 7',
            borderRadius: 'var(--mantine-radius-md)',
            overflow: 'hidden',
            border: '1px solid var(--app-border)',
          }}
        >
          {material.imageUrl ? (
            <Image
              src={material.imageUrl}
              alt={t('materials:preview.imageAlt', { name: material.name })}
              h="100%"
              w="100%"
              fit="cover"
            />
          ) : (
            <Box
              style={{
                position: 'absolute',
                inset: 0,
                background: `var(--mantine-color-${visual.accent}-light)`,
                color: `var(--mantine-color-${visual.accent}-filled)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Box style={{ position: 'absolute', inset: 0 }}>
                <CategoryTexture
                  pattern={visual.pattern}
                  width={480}
                  height={200}
                  opacity={0.4}
                />
              </Box>
              <Box
                style={{
                  position: 'relative',
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  background: 'var(--app-surface)',
                  border: '1px solid var(--app-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CategoryIcon
                  category={material.category}
                  size={30}
                  color="var(--mantine-color-text)"
                />
              </Box>
            </Box>
          )}
        </Box>

        <Stack gap={4}>
          <Group gap="sm" wrap="wrap">
            <Text fz={22} fw={600}>
              {material.name}
            </Text>
            <MaterialCategoryBadge category={material.category} />
          </Group>
          {material.supplier ? (
            <Text fz="sm" c="dimmed">
              {material.supplier}
            </Text>
          ) : null}
          {material.notes ? (
            <Text fz="sm" c="dimmed" mt={4}>
              {material.notes}
            </Text>
          ) : null}
        </Stack>

        <Box
          style={{
            border: '1px solid var(--app-border)',
            borderRadius: 'var(--mantine-radius-md)',
            background: 'var(--app-surface-muted)',
            padding: 16,
          }}
        >
          <Text
            fz="xs"
            c="dimmed"
            fw={600}
            tt="uppercase"
            style={{ letterSpacing: '0.04em' }}
            mb="sm"
          >
            {t('materials:preview.specs')}
          </Text>
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
            <Spec
              label={t('materials:columns.unit')}
              value={t(`materials:units.${material.unit}_long`)}
            />
            <Spec
              label={t('materials:columns.unitPrice')}
              value={formatCurrency(material.unitPrice, material.currency, {
                maximumFractionDigits: 0,
              })}
              numeric
            />
            <Spec
              label={t('materials:columns.coverage')}
              value={`${formatNumber(material.coverage)} m² / ${t(`materials:units.${material.unit}`)}`}
              numeric
            />
            <Spec
              label={t('materials:columns.waste')}
              value={`${formatNumber(material.wastePct)} %`}
              numeric
            />
          </SimpleGrid>
        </Box>

        <Group justify="flex-end" gap="sm">
          <Button
            variant="default"
            color="danger"
            leftSection={<Trash size={16} />}
            onClick={() => onDelete(material)}
          >
            {t('materials:preview.delete')}
          </Button>
          <Button
            leftSection={<PencilSimple size={16} />}
            onClick={() => onEdit(material)}
          >
            {t('materials:preview.edit')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function Spec({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) {
  return (
    <Stack gap={2}>
      <Text fz="xs" c="dimmed">
        {label}
      </Text>
      <Text className={numeric ? 'app-numeric' : ''} fz="sm" fw={500}>
        {value}
      </Text>
    </Stack>
  )
}
