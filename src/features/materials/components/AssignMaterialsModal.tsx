import {
  Alert,
  Box,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
} from '@mantine/core'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ID } from '@/shared/types'
import { SpacePlan2D } from '@/shared/ui'
import { formatCurrency, formatNumber } from '@/shared/utils/format'
import { categoryVisual } from '../domain/category-visuals'
import { categoryUsageTargets, type UsageTarget } from '../domain/discovery'
import {
  calcSurfaceQuantity,
  type DefaultRates,
} from '../domain/quantity'
import type { Material } from '../domain/material.types'
import { CategoryIcon } from './CategoryIcon'
import { toSurfaceVisual } from './surface-visual'

/**
 * Assignment shape returned to the caller. Each surface is either a real
 * material id or `null` (use default rates). The composition layer persists
 * this onto the Space row.
 */
export interface MaterialAssignmentInput {
  floorMaterialId: ID | null
  wallMaterialId: ID | null
  ceilingMaterialId: ID | null
}

interface AssignMaterialsModalProps {
  opened: boolean
  onClose: () => void
  /** Just the primitives — so this component does not import the spaces feature. */
  spaceName: string
  spaceLength: number
  spaceWidth: number
  spaceHeight: number
  floorArea: number
  wallArea: number
  ceilingArea: number
  current: MaterialAssignmentInput
  materials: Material[]
  rates: DefaultRates
  onSubmit: (assignments: MaterialAssignmentInput) => void | Promise<void>
  isSubmitting: boolean
  errorMessage?: string | undefined
}

type Surface = 'floor' | 'wall' | 'ceiling'

const NONE_VALUE = '__none__'

export function AssignMaterialsModal({
  opened,
  onClose,
  spaceName,
  spaceLength,
  spaceWidth,
  spaceHeight,
  floorArea,
  wallArea,
  ceilingArea,
  current,
  materials,
  rates,
  onSubmit,
  isSubmitting,
  errorMessage,
}: AssignMaterialsModalProps) {
  const { t } = useTranslation(['materials'])

  const [assignments, setAssignments] = useState<MaterialAssignmentInput>(current)

  useEffect(() => {
    if (opened) setAssignments(current)
  }, [opened, current])

  const activeMaterials = useMemo(
    () => materials.filter((material) => material.active),
    [materials],
  )

  // Surface-aware option lists. A floor surface only sees materials whose
  // category supports floors (per `categoryUsageTargets`); same for wall /
  // ceiling. This turns the assign dialog from a generic Select into a
  // catalog where the surface narrows the candidates automatically.
  const optionsByUsage = useMemo(() => {
    const buildFor = (usage: UsageTarget) => [
      { value: NONE_VALUE, label: t('materials:assign.none') },
      ...activeMaterials
        .filter((material) => categoryUsageTargets(material.category).includes(usage))
        .map((material) => ({ value: material.id, label: material.name })),
    ]
    return {
      floor: buildFor('floor'),
      wall: buildFor('wall'),
      ceiling: buildFor('ceiling'),
    } as const
  }, [activeMaterials, t])

  const materialsById = useMemo(() => {
    const map = new Map<ID, Material>()
    for (const material of materials) map.set(material.id, material)
    return map
  }, [materials])

  const onSelect = (surface: Surface, value: string | null) => {
    const next: ID | null = value && value !== NONE_VALUE ? value : null
    setAssignments((prev) => ({ ...prev, [surfaceKey(surface)]: next }))
  }

  const handleSubmit = async () => {
    await onSubmit(assignments)
  }

  const floorMaterial = assignments.floorMaterialId
    ? (materialsById.get(assignments.floorMaterialId) ?? null)
    : null
  const wallMaterial = assignments.wallMaterialId
    ? (materialsById.get(assignments.wallMaterialId) ?? null)
    : null
  const ceilingMaterial = assignments.ceilingMaterialId
    ? (materialsById.get(assignments.ceilingMaterialId) ?? null)
    : null

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('materials:assign.title')}
      centered
      size="xl"
      radius="md"
    >
      <Stack gap="md">
        <Text fz="sm" c="dimmed">
          {t('materials:assign.subtitle', { name: spaceName })}
        </Text>

        {errorMessage ? (
          <Alert color="danger" variant="light" radius="md">
            {errorMessage}
          </Alert>
        ) : null}

        {activeMaterials.length === 0 ? (
          <Alert color="warn" variant="light" radius="md">
            {t('materials:assign.noActive')}
          </Alert>
        ) : null}

        <SpacePlan2D
          length={spaceLength}
          width={spaceWidth}
          height={spaceHeight}
          floor={toSurfaceVisual(floorMaterial)}
          wall={toSurfaceVisual(wallMaterial)}
          ceiling={toSurfaceVisual(ceilingMaterial)}
          maxHeight={260}
        />

        <SurfaceRow
          surface="floor"
          area={floorArea}
          material={floorMaterial}
          materialOptions={optionsByUsage.floor}
          rates={rates}
          onSelect={(value) => onSelect('floor', value)}
        />
        <SurfaceRow
          surface="wall"
          area={wallArea}
          material={wallMaterial}
          materialOptions={optionsByUsage.wall}
          rates={rates}
          onSelect={(value) => onSelect('wall', value)}
        />
        <SurfaceRow
          surface="ceiling"
          area={ceilingArea}
          material={ceilingMaterial}
          materialOptions={optionsByUsage.ceiling}
          rates={rates}
          onSelect={(value) => onSelect('ceiling', value)}
        />

        <Group justify="flex-end" gap="sm" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose} disabled={isSubmitting}>
            {t('materials:actions.cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={isSubmitting}>
            {t('materials:assign.submit')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function surfaceKey(surface: Surface): keyof MaterialAssignmentInput {
  if (surface === 'floor') return 'floorMaterialId'
  if (surface === 'wall') return 'wallMaterialId'
  return 'ceilingMaterialId'
}

interface SurfaceRowProps {
  surface: Surface
  area: number
  material: Material | null
  materialOptions: { value: string; label: string }[]
  rates: DefaultRates
  onSelect: (value: string | null) => void
}

function SurfaceRow({
  surface,
  area,
  material,
  materialOptions,
  rates,
  onSelect,
}: SurfaceRowProps) {
  const { t } = useTranslation(['materials'])
  const result = material ? calcSurfaceQuantity(area, material) : null

  const ratePerSqm =
    surface === 'floor'
      ? rates.floorPerSqm
      : surface === 'wall'
        ? rates.wallPerSqm
        : (rates.ceilingPerSqm ?? rates.floorPerSqm)
  const fallbackAmount = (area > 0 ? area : 0) * ratePerSqm
  const amount = material && result ? Number(result.amount) : fallbackAmount
  const currency = material ? material.currency : rates.currency

  const surfaceLabel = t(`materials:assign.${surface === 'wall' ? 'walls' : surface}`)
  const unitLabel = material ? t(`materials:units.${material.unit}`) : null
  const accent = material ? categoryVisual(material.category).accent : 'gray'

  return (
    <Stack
      gap="sm"
      p="md"
      style={{
        borderRadius: 'var(--mantine-radius-md)',
        border: '1px solid var(--app-border)',
        background: 'var(--app-surface)',
      }}
    >
      <Group justify="space-between" align="flex-start" gap="md" wrap="wrap">
        <Group gap="sm" wrap="nowrap" align="center">
          <Box
            style={{
              width: 28,
              height: 28,
              borderRadius: 'var(--mantine-radius-sm)',
              background: `var(--mantine-color-${accent}-light)`,
              color: `var(--mantine-color-${accent}-filled)`,
              border: '1px solid var(--app-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {material ? (
              <CategoryIcon category={material.category} size={14} />
            ) : (
              <Box
                component="span"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--mantine-color-dimmed)',
                  opacity: 0.5,
                }}
              />
            )}
          </Box>
          <Stack gap={2}>
            <Text fz="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.04em' }}>
              {surfaceLabel}
            </Text>
            <Text className="app-numeric" fz="md" fw={500}>
              {formatNumber(area)} m²
            </Text>
          </Stack>
        </Group>

        <Select
          data={materialOptions}
          value={material?.id ?? NONE_VALUE}
          onChange={onSelect}
          allowDeselect={false}
          checkIconPosition="right"
          searchable
          maw={320}
          style={{ flex: 1 }}
        />
      </Group>

      <Group
        justify="space-between"
        pt="sm"
        wrap="wrap"
        gap="lg"
        style={{ borderTop: '1px solid var(--app-border)' }}
      >
        <Metric
          label={t('materials:assign.quantityLabel')}
          value={
            material && result ? (
              <>
                <Text component="span" className="app-numeric" fz="sm" fw={500}>
                  {formatNumber(result.quantity)}
                </Text>
                <Text component="span" fz="xs" c="dimmed" ml={4}>
                  {unitLabel}
                </Text>
              </>
            ) : (
              <Text component="span" fz="sm" c="dimmed">
                {t('materials:breakdown.default')}
              </Text>
            )
          }
        />
        <Metric
          label={t('materials:assign.totalLabel')}
          value={
            <Text component="span" className="app-numeric" fz="sm" fw={500}>
              {formatCurrency(amount, currency, { maximumFractionDigits: 0 })}
            </Text>
          }
        />
      </Group>
    </Stack>
  )
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack gap={2}>
      <Text fz="xs" c="dimmed">
        {label}
      </Text>
      <Text fz="sm">{value}</Text>
    </Stack>
  )
}
