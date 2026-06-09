import { ActionIcon, Box, Collapse, Group, Menu, Table, Text } from '@mantine/core'
import { CaretDown, CaretRight, DotsThreeVertical, PencilSimple, Trash } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ID } from '@/shared/types'
import { formatCurrency, formatNumber } from '@/shared/utils/format'
import { DEFAULT_RATES } from '../config/rates'
import { calcCost, calcMeasurements } from '../domain/calc'
import type { Space } from '../domain/space.types'

/**
 * Minimal cost shape the table needs per space — a string amount + currency.
 * Defined in `spaces/` (not `materials/`) on purpose so this component does
 * not import from another feature; the composition layer is responsible for
 * producing values in this shape.
 */
export interface SpaceCostEntry {
  totalAmount: string
  currency: string
}

interface SpacesTableProps {
  spaces: Space[]
  onEdit: (space: Space) => void
  onDelete: (space: Space) => void
  /** Optional: assign-materials menu entry. When omitted the row only has Edit/Delete. */
  onAssignMaterials?: (space: Space) => void
  /** Per-space cost override. Falls back to the Phase-2 placeholder rates when absent. */
  costsBySpaceId?: ReadonlyMap<ID, SpaceCostEntry>
  /** Optional collapsible detail panel rendered under each row (cost breakdown). */
  renderBreakdown?: (space: Space) => ReactNode
}

export function SpacesTable({
  spaces,
  onEdit,
  onDelete,
  onAssignMaterials,
  costsBySpaceId,
  renderBreakdown,
}: SpacesTableProps) {
  const { t } = useTranslation(['spaces', 'materials'])
  const [expanded, setExpanded] = useState<ID | null>(null)
  const expandable = Boolean(renderBreakdown)

  return (
    <Table.ScrollContainer minWidth={860}>
      <Table verticalSpacing="md" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            {expandable ? <Table.Th w={32} aria-label="" /> : null}
            <Table.Th>{t('spaces:columns.name')}</Table.Th>
            <Table.Th>{t('spaces:columns.dimensions')}</Table.Th>
            <Table.Th ta="end">{t('spaces:columns.floor')}</Table.Th>
            <Table.Th ta="end">{t('spaces:columns.walls')}</Table.Th>
            <Table.Th ta="end">{t('spaces:columns.ceiling')}</Table.Th>
            <Table.Th ta="end">{t('spaces:columns.cost')}</Table.Th>
            <Table.Th w={48} aria-label="" />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {spaces.map((space) => {
            const measurements = calcMeasurements(space)
            const override = costsBySpaceId?.get(space.id)
            const cost = override ?? calcCost(measurements, DEFAULT_RATES)
            const isExpanded = expandable && expanded === space.id

            return (
              <SpaceRowGroup
                key={space.id}
                space={space}
                cost={cost}
                measurements={measurements}
                expandable={expandable}
                isExpanded={isExpanded}
                onToggle={() =>
                  setExpanded((prev) => (prev === space.id ? null : space.id))
                }
                onEdit={onEdit}
                onDelete={onDelete}
                {...(onAssignMaterials ? { onAssignMaterials } : {})}
                {...(renderBreakdown ? { renderBreakdown } : {})}
              />
            )
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

interface SpaceRowGroupProps {
  space: Space
  cost: { totalAmount: string; currency: string }
  measurements: { floorArea: number; wallArea: number; ceilingArea: number }
  expandable: boolean
  isExpanded: boolean
  onToggle: () => void
  onEdit: (space: Space) => void
  onDelete: (space: Space) => void
  onAssignMaterials?: (space: Space) => void
  renderBreakdown?: (space: Space) => ReactNode
}

function SpaceRowGroup({
  space,
  cost,
  measurements,
  expandable,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
  onAssignMaterials,
  renderBreakdown,
}: SpaceRowGroupProps) {
  const { t } = useTranslation(['spaces', 'materials'])
  const m2 = t('spaces:units.m2')

  return (
    <>
      <Table.Tr style={{ cursor: expandable ? 'pointer' : 'default' }}>
        {expandable ? (
          <Table.Td onClick={onToggle}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={t('materials:breakdown.title')}
            >
              {isExpanded ? <CaretDown size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}
            </ActionIcon>
          </Table.Td>
        ) : null}
        <Table.Td onClick={expandable ? onToggle : undefined}>
          <Text fz="sm" fw={500}>
            {space.name}
          </Text>
        </Table.Td>
        <Table.Td onClick={expandable ? onToggle : undefined}>
          <Text className="app-numeric" fz="sm" c="dimmed">
            {formatNumber(space.length)} × {formatNumber(space.width)} ×{' '}
            {formatNumber(space.height)}
          </Text>
        </Table.Td>
        <Table.Td ta="end" onClick={expandable ? onToggle : undefined}>
          <NumericCell value={measurements.floorArea} unit={m2} />
        </Table.Td>
        <Table.Td ta="end" onClick={expandable ? onToggle : undefined}>
          <NumericCell value={measurements.wallArea} unit={m2} />
        </Table.Td>
        <Table.Td ta="end" onClick={expandable ? onToggle : undefined}>
          <NumericCell value={measurements.ceilingArea} unit={m2} />
        </Table.Td>
        <Table.Td ta="end" onClick={expandable ? onToggle : undefined}>
          <Text className="app-numeric" fz="sm" fw={500}>
            {formatCurrency(Number(cost.totalAmount), cost.currency, {
              maximumFractionDigits: 0,
            })}
          </Text>
        </Table.Td>
        <Table.Td>
          <Group justify="flex-end" gap={0}>
            <Menu position="bottom-end" withinPortal shadow="sm" width={220}>
              <Menu.Target>
                <ActionIcon aria-label={t('spaces:editSpace')}>
                  <DotsThreeVertical size={18} weight="bold" />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<PencilSimple size={16} />}
                  onClick={() => onEdit(space)}
                >
                  {t('spaces:editSpace')}
                </Menu.Item>
                {onAssignMaterials ? (
                  <Menu.Item onClick={() => onAssignMaterials(space)}>
                    {t('materials:assign.title')}
                  </Menu.Item>
                ) : null}
                <Menu.Item
                  color="danger"
                  leftSection={<Trash size={16} />}
                  onClick={() => onDelete(space)}
                >
                  {t('spaces:delete.confirm')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Table.Td>
      </Table.Tr>

      {expandable && renderBreakdown ? (
        <Table.Tr>
          <Table.Td
            colSpan={8}
            style={{
              padding: 0,
              borderBottom: isExpanded ? '1px solid var(--app-border)' : '0 none',
            }}
          >
            <Collapse expanded={isExpanded}>
              <Box px="md" pb="md" pt="xs">
                {renderBreakdown(space)}
              </Box>
            </Collapse>
          </Table.Td>
        </Table.Tr>
      ) : null}
    </>
  )
}

function NumericCell({ value, unit }: { value: number; unit: string }) {
  return (
    <Text className="app-numeric" fz="sm">
      {formatNumber(value)}
      <Text component="span" fz="xs" c="dimmed" ml={4}>
        {unit}
      </Text>
    </Text>
  )
}
