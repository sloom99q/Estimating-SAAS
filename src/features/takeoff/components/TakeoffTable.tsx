import { useCallback, useMemo, useState } from 'react'
import { Badge, Group, NumberInput, Select, Stack, Table, Text, Tooltip } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import {
  FINISH_CODE_VOCAB,
  type FinishCode,
  type TakeoffBundle,
  type TakeoffItemDto,
  type ValidationFlagDto,
} from '../api/takeoff.api'
import { usePatchTakeoffItem } from '../api/useTakeoff'
import { ConfidenceChip } from './ConfidenceChip'

interface TakeoffTableProps {
  projectId: string
  bundle: TakeoffBundle
  needsReviewOnly: boolean
}

const NEEDS_REVIEW_CONFIDENCE = 85

function groupByCategory(items: TakeoffItemDto[]): Map<string, TakeoffItemDto[]> {
  const map = new Map<string, TakeoffItemDto[]>()
  for (const item of items) {
    const list = map.get(item.category)
    if (list) list.push(item)
    else map.set(item.category, [item])
  }
  // Stable category order: ROOM, DOOR, WINDOW first, then alphabetical.
  const priority = new Map([
    ['ROOM', 0],
    ['DOOR', 1],
    ['WINDOW', 2],
  ])
  return new Map(
    Array.from(map.entries()).sort(([a], [b]) => {
      const pa = priority.get(a) ?? 99
      const pb = priority.get(b) ?? 99
      return pa - pb || a.localeCompare(b)
    }),
  )
}

function flagSeverityColor(s: ValidationFlagDto['severity']): string {
  if (s === 'ERROR') return 'red'
  if (s === 'WARN') return 'yellow'
  return 'blue'
}

/**
 * Sprint-9 S9-3 — per-room finish dropdown. Closed 12-code vocab + the
 * BATHROOM sentinel. Edits POST to PATCH /api/takeoff-items/:id and the
 * server writes a Correction row so the data-quality loop captures
 * what the colour mapper got wrong.
 */
function FinishCodeCell({
  item,
  onSave,
  saving,
}: {
  item: TakeoffItemDto
  onSave: (next: FinishCode | null) => void
  saving: boolean
}) {
  const meta = (item.meta ?? {}) as { finish_code?: string | null; finishSource?: string | null }
  const current = (meta.finish_code ?? null) as FinishCode | null
  return (
    <Select
      value={current ?? null}
      onChange={(v) => onSave(v as FinishCode | null)}
      data={FINISH_CODE_VOCAB.map((c) => ({ value: c, label: c }))}
      placeholder="—"
      size="xs"
      clearable
      searchable
      disabled={saving}
      style={{ maxWidth: 130 }}
      rightSection={
        meta.finishSource === 'human-override' ? (
          <Tooltip label="Set by reviewer">
            <Badge size="xs" variant="dot" color="grape" />
          </Tooltip>
        ) : null
      }
    />
  )
}

function QtyFinalCell({
  item,
  onSave,
  saving,
}: {
  item: TakeoffItemDto
  onSave: (next: number | null) => void
  saving: boolean
}) {
  const initial = item.qtyFinal ?? item.qtyAi ?? ''
  const [value, setValue] = useState<string | number>(initial === '' ? '' : Number(initial))
  const stringValue = typeof value === 'number' ? String(value) : value
  const dirty = stringValue !== String(initial)

  return (
    <NumberInput
      value={value === '' ? '' : Number(value)}
      onChange={(v) => setValue(v as number | string)}
      min={0}
      step={0.1}
      decimalScale={4}
      disabled={saving}
      size="xs"
      hideControls
      style={{ maxWidth: 110 }}
      onBlur={() => {
        if (!dirty) return
        const num =
          stringValue === '' || stringValue === null ? null : Number.parseFloat(stringValue)
        if (num !== null && Number.isNaN(num)) return
        onSave(num)
      }}
    />
  )
}

export function TakeoffTable({ projectId, bundle, needsReviewOnly }: TakeoffTableProps) {
  const { t } = useTranslation('takeoff')
  const patch = usePatchTakeoffItem(projectId)
  const [savingId, setSavingId] = useState<string | null>(null)

  const visibleItems = useMemo(() => {
    if (!needsReviewOnly) return bundle.items
    return bundle.items.filter((item) => {
      if (item.confidence < NEEDS_REVIEW_CONFIDENCE) return true
      const itemFlags = bundle.flagsByItem[item.id] ?? []
      return itemFlags.some((f) => !f.resolved)
    })
  }, [bundle, needsReviewOnly])

  const grouped = useMemo(() => groupByCategory(visibleItems), [visibleItems])

  const handleSave = useCallback(
    (item: TakeoffItemDto, next: number | null) => {
      setSavingId(item.id)
      patch.mutate(
        { id: item.id, payload: { qtyFinal: next } },
        {
          onSettled: () => {
            setSavingId((id) => (id === item.id ? null : id))
          },
        },
      )
    },
    [patch],
  )

  // S9-3 finish-code override handler — only meaningful for ROOM rows.
  const handleFinishSave = useCallback(
    (item: TakeoffItemDto, next: FinishCode | null) => {
      setSavingId(item.id)
      patch.mutate(
        { id: item.id, payload: { finishCode: next } },
        {
          onSettled: () => {
            setSavingId((id) => (id === item.id ? null : id))
          },
        },
      )
    },
    [patch],
  )

  if (bundle.items.length === 0) {
    return <Text c="dimmed">{t('table.empty')}</Text>
  }

  return (
    <Stack gap="lg">
      {Array.from(grouped.entries()).map(([category, items]) => (
        <Stack key={category} gap="xs">
          <Group justify="space-between">
            <Text fw={600}>{t(`category.${category}`, { defaultValue: category })}</Text>
            <Badge variant="light">{items.length}</Badge>
          </Group>
          <Table striped withTableBorder withColumnBorders highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('table.headers.tag')}</Table.Th>
                <Table.Th>{t('table.headers.description')}</Table.Th>
                <Table.Th>{t('table.headers.unit')}</Table.Th>
                <Table.Th>{t('table.headers.qtyAi')}</Table.Th>
                <Table.Th>{t('table.headers.qtyFinal')}</Table.Th>
                {category === 'ROOM' ? (
                  <Table.Th>{t('table.headers.finish', { defaultValue: 'Finish' })}</Table.Th>
                ) : null}
                <Table.Th>{t('table.headers.confidence')}</Table.Th>
                <Table.Th>{t('table.headers.flags')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item) => {
                const flags = bundle.flagsByItem[item.id] ?? []
                const saving = savingId === item.id
                return (
                  <Table.Tr key={item.id}>
                    <Table.Td>
                      <Text size="sm">{item.tag ?? t('table.groupNoTag')}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{item.description}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" className="app-numeric">{item.unit}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" className="app-numeric">{item.qtyAi ?? '—'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <QtyFinalCell
                        item={item}
                        saving={saving}
                        onSave={(next) => handleSave(item, next)}
                      />
                    </Table.Td>
                    {category === 'ROOM' ? (
                      <Table.Td>
                        <FinishCodeCell
                          item={item}
                          saving={saving}
                          onSave={(next) => handleFinishSave(item, next)}
                        />
                      </Table.Td>
                    ) : null}
                    <Table.Td>
                      <ConfidenceChip confidence={item.confidence} />
                    </Table.Td>
                    <Table.Td>
                      {flags.length === 0 ? (
                        <Text size="xs" c="dimmed">—</Text>
                      ) : (
                        <Group gap={4}>
                          {flags.map((flag) => (
                            <Tooltip key={flag.id} label={flag.message} multiline>
                              <Badge
                                color={flagSeverityColor(flag.severity)}
                                variant="light"
                                radius="sm"
                              >
                                {flag.rule}
                              </Badge>
                            </Tooltip>
                          ))}
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Stack>
      ))}
    </Stack>
  )
}
