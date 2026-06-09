import { ActionIcon, Badge, Box, Group, Image, Menu, Table, Text } from '@mantine/core'
import { DotsThreeVertical, PencilSimple, Trash } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { formatCurrency, formatNumber } from '@/shared/utils/format'
import { categoryVisual } from '../domain/category-visuals'
import type { Material } from '../domain/material.types'
import { CategoryIcon } from './CategoryIcon'
import { CategoryTexture } from './CategoryTexture'
import { MaterialCategoryBadge } from './MaterialCategoryBadge'

interface MaterialsTableProps {
  materials: Material[]
  onOpen: (material: Material) => void
  onEdit: (material: Material) => void
  onDelete: (material: Material) => void
}

export function MaterialsTable({ materials, onOpen, onEdit, onDelete }: MaterialsTableProps) {
  const { t } = useTranslation(['materials'])

  return (
    <Table.ScrollContainer minWidth={920}>
      <Table verticalSpacing="md" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={64} aria-label="" />
            <Table.Th>{t('materials:columns.name')}</Table.Th>
            <Table.Th>{t('materials:columns.category')}</Table.Th>
            <Table.Th>{t('materials:columns.unit')}</Table.Th>
            <Table.Th ta="end">{t('materials:columns.unitPrice')}</Table.Th>
            <Table.Th ta="end">{t('materials:columns.coverage')}</Table.Th>
            <Table.Th ta="end">{t('materials:columns.waste')}</Table.Th>
            <Table.Th>{t('materials:columns.supplier')}</Table.Th>
            <Table.Th>{t('materials:columns.status')}</Table.Th>
            <Table.Th w={48} aria-label="" />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {materials.map((material) => (
            <Table.Tr
              key={material.id}
              onClick={() => onOpen(material)}
              style={{ cursor: 'pointer' }}
            >
              <Table.Td>
                <Thumbnail material={material} />
              </Table.Td>
              <Table.Td>
                <Text fz="sm" fw={500}>
                  {material.name}
                </Text>
                {material.notes ? (
                  <Text fz="xs" c="dimmed" lineClamp={1}>
                    {material.notes}
                  </Text>
                ) : null}
              </Table.Td>
              <Table.Td>
                <MaterialCategoryBadge category={material.category} />
              </Table.Td>
              <Table.Td>
                <Text fz="sm" c="dimmed">
                  {t(`materials:units.${material.unit}_long`)}
                </Text>
              </Table.Td>
              <Table.Td ta="end">
                <Text className="app-numeric" fz="sm">
                  {formatCurrency(material.unitPrice, material.currency)}
                </Text>
              </Table.Td>
              <Table.Td ta="end">
                <Text className="app-numeric" fz="sm">
                  {formatNumber(material.coverage)}
                  <Text component="span" fz="xs" c="dimmed" ml={4}>
                    m² / {t(`materials:units.${material.unit}`)}
                  </Text>
                </Text>
              </Table.Td>
              <Table.Td ta="end">
                <Text className="app-numeric" fz="sm">
                  {formatNumber(material.wastePct)}%
                </Text>
              </Table.Td>
              <Table.Td>
                {material.supplier ? (
                  <Text fz="sm">{material.supplier}</Text>
                ) : (
                  <Text fz="sm" c="dimmed">
                    —
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                {material.active ? (
                  <Badge color="success">{t('materials:status.active')}</Badge>
                ) : (
                  <Badge color="gray">{t('materials:status.inactive')}</Badge>
                )}
              </Table.Td>
              <Table.Td onClick={(event) => event.stopPropagation()}>
                <Group justify="flex-end" gap={0}>
                  <Menu position="bottom-end" withinPortal shadow="sm" width={180}>
                    <Menu.Target>
                      <ActionIcon aria-label={t('materials:editMaterial')}>
                        <DotsThreeVertical size={18} weight="bold" />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<PencilSimple size={16} />}
                        onClick={() => onEdit(material)}
                      >
                        {t('materials:editMaterial')}
                      </Menu.Item>
                      <Menu.Item
                        color="danger"
                        leftSection={<Trash size={16} />}
                        onClick={() => onDelete(material)}
                      >
                        {t('materials:deleteMaterial')}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

/**
 * Small square material preview used as the first column of the table. Image
 * if the material has one, category swatch (tinted texture + icon) otherwise.
 */
function Thumbnail({ material }: { material: Material }) {
  const visual = categoryVisual(material.category)
  return (
    <Box
      style={{
        position: 'relative',
        width: 44,
        height: 44,
        borderRadius: 'var(--mantine-radius-sm)',
        overflow: 'hidden',
        border: '1px solid var(--app-border)',
      }}
    >
      {material.imageUrl ? (
        <Image src={material.imageUrl} alt="" h="100%" w="100%" fit="cover" />
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
            <CategoryTexture pattern={visual.pattern} width={44} height={44} opacity={0.5} />
          </Box>
          <CategoryIcon category={material.category} size={18} weight="regular" />
        </Box>
      )}
    </Box>
  )
}
