import { useCallback, useMemo, useState } from 'react'
import { Badge, Button, Group, NumberInput, Select, Stack, Table, Text, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import {
  FLOOR_FINISH_RATE_AED_PER_M2,
  FLOOR_FINISH_VOCAB,
  acceptFinishSuggestions,
  type FinishCode,
  type FloorFinishCode,
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
 * PIVOT — per-room finish picker. Dual state:
 *   - meta.finish_code  = HUMAN-CONFIRMED. The only thing PRICE reads.
 *                         Green ✓ badge. Status = "confirmed".
 *   - meta.finishSuggestion.code = AI proposal (color-sample or vision).
 *                         Yellow ⚠ badge. Status = "pending".
 *
 * Three primary actions in the row:
 *   • Accept       → confirm the AI suggestion (1 click)
 *   • Change       → pick a different code from FLOOR_FINISH_VOCAB
 *   • Clear        → unconfirm (reverts to pending; the suggestion stays)
 *
 * Wall codes (FN/WD) and landscape (LS) are deliberately ABSENT from the
 * dropdown — a reviewer cannot mis-assign a wall code as a floor.
 *
 * The resolved AED/m² rate is shown next to the code so the reviewer
 * sees the impact of their click. Source of truth is RateLibraryItem on
 * the server; this is a display-only mirror.
 */
function FinishCodeCell({
  item,
  onSave,
  saving,
}: {
  item: TakeoffItemDto
  onSave: (next: FloorFinishCode | null) => void
  saving: boolean
}) {
  const meta = (item.meta ?? {}) as {
    finish_code?: string | null
    finishSource?: string | null
    finishSuggestion?: { code?: string | null; confidence?: number | null } | null
  }
  const confirmed = (meta.finish_code ?? null) as FloorFinishCode | null
  const suggested = (meta.finishSuggestion?.code ?? null) as FloorFinishCode | null
  const isConfirmed = !!confirmed
  const hasSuggestion = !!suggested && !isConfirmed

  const rateFor = (code: FloorFinishCode | null): string => {
    if (code === null) return '—'
    const r = FLOOR_FINISH_RATE_AED_PER_M2[code]
    return typeof r === 'number' ? `${r} AED/m²` : 'P/S'
  }

  return (
    <Stack gap={4}>
      <Group gap={6} wrap="nowrap" align="center">
        <Select
          value={confirmed}
          onChange={(v) => onSave(v as FloorFinishCode | null)}
          data={FLOOR_FINISH_VOCAB.map((c) => ({
            value: c,
            label: `${c} (${rateFor(c as FloorFinishCode)})`,
          }))}
          placeholder={hasSuggestion ? `${suggested} (suggested)` : 'Pick code'}
          size="xs"
          clearable
          searchable
          disabled={saving}
          style={{ minWidth: 200 }}
        />
        {hasSuggestion ? (
          <Tooltip label={`Accept AI suggestion ${suggested}`}>
            <Button
              size="xs"
              variant="light"
              color="blue"
              onClick={() => onSave(suggested)}
              disabled={saving}
            >
              Accept {suggested}
            </Button>
          </Tooltip>
        ) : null}
      </Group>
      <Group gap={6}>
        {isConfirmed ? (
          <Badge color="green" variant="filled" size="xs">
            ✓ confirmed — {confirmed} · {rateFor(confirmed)}
          </Badge>
        ) : hasSuggestion ? (
          <Badge color="yellow" variant="light" size="xs">
            ⚠ pending — suggested {suggested}
          </Badge>
        ) : (
          <Badge color="red" variant="light" size="xs">
            ⚠ pending — no suggestion
          </Badge>
        )}
        {meta.finishSource === 'cleared-by-reviewer' ? (
          <Badge color="gray" variant="dot" size="xs">
            cleared
          </Badge>
        ) : null}
      </Group>
    </Stack>
  )
}

/**
 * PIVOT — bulk Accept-all banner at the top of the ROOM section. POSTs
 * to /api/projects/:id/finishes/accept-suggestions with the default
 * onlyFloorFinishCodes=true so wall codes never get auto-confirmed.
 */
function BulkAcceptBanner({
  projectId,
  rooms,
}: {
  projectId: string
  rooms: TakeoffItemDto[]
}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const acceptable = useMemo(() => {
    let n = 0
    for (const r of rooms) {
      const m = (r.meta ?? {}) as {
        finish_code?: string | null
        finishSuggestion?: { code?: string | null } | null
      }
      const code = m.finishSuggestion?.code ?? null
      const confirmed = m.finish_code ?? null
      if (confirmed) continue
      if (!code) continue
      if (!FLOOR_FINISH_VOCAB.includes(code as FloorFinishCode)) continue
      n += 1
    }
    return n
  }, [rooms])

  if (acceptable === 0) return null

  return (
    <Group justify="space-between" p="xs" style={{ background: 'var(--mantine-color-blue-0)', borderRadius: 4 }}>
      <Text size="sm">
        AI suggested floor finishes for <b>{acceptable}</b> room{acceptable === 1 ? '' : 's'}.
        Accept the lot, then fix exceptions inline.
      </Text>
      <Button
        size="xs"
        loading={busy}
        onClick={async () => {
          setBusy(true)
          try {
            const r = await acceptFinishSuggestions(projectId, {})
            notifications.show({
              color: 'green',
              title: 'Suggestions accepted',
              message: `${r.accepted} room${r.accepted === 1 ? '' : 's'} confirmed · ${r.skipped} skipped`,
            })
            await qc.invalidateQueries({ queryKey: ['projects', projectId, 'takeoff'] })
          } catch (err) {
            notifications.show({
              color: 'red',
              title: 'Bulk accept failed',
              message: err instanceof Error ? err.message : 'Unknown error',
            })
          } finally {
            setBusy(false)
          }
        }}
      >
        Accept all {acceptable} suggestion{acceptable === 1 ? '' : 's'}
      </Button>
    </Group>
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
      // AI-estimation engine: an ESTIMATED row that's still at status=AI
      // ALWAYS needs review — that's the whole point of "Confirm in the
      // verify UI". Don't gate it by confidence, because high-confidence
      // vanities (95) need just as much expert sign-off as low-confidence
      // ones (80). Once confirmed (status=EDITED/APPROVED), it drops out.
      if (item.basis === 'ESTIMATED' && item.status === 'AI') return true
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

  // PIVOT — accepts a FLOOR-only code (or null to clear). The PATCH
  // server-side stamps meta.finish_code + finishSource='human-confirmed'.
  const handleFinishSave = useCallback(
    (item: TakeoffItemDto, next: FloorFinishCode | null) => {
      setSavingId(item.id)
      patch.mutate(
        { id: item.id, payload: { finishCode: next as FinishCode | null } },
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
          {category === 'ROOM' ? (
            <BulkAcceptBanner projectId={projectId} rooms={items} />
          ) : null}
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
                // AI-est roadmap #1 — render an inline reasoning line +
                // Confirm/✓-confirmed control for SKIRTING (and any future
                // ESTIMATED basis row). Confirm flips status AI → EDITED
                // so the line enters the next BOQ generation.
                const isEstimated = item.basis === 'ESTIMATED'
                const meta = (item.meta ?? {}) as {
                  estimationReasoning?: string
                  priorName?: string
                  floorFinishCode?: string
                }
                const reasoningLine = isEstimated ? meta.estimationReasoning ?? null : null
                const confirmed = isEstimated && item.status !== 'AI'
                // Expert call 2026-06-20: row background must make
                // ESTIMATED status unmistakable. Green confidence chips
                // were being read as "confirmed" — at-a-glance row tint
                // removes that confusion. AI = warm yellow tint = work
                // pending; EDITED/APPROVED = subtle green = done.
                const rowStyle = !isEstimated
                  ? undefined
                  : confirmed
                  ? { background: 'rgba(64, 192, 87, 0.06)' }
                  : { background: 'rgba(250, 176, 5, 0.08)' }
                return (
                  <Table.Tr key={item.id} style={rowStyle}>
                    <Table.Td>
                      <Text size="sm">{item.tag ?? t('table.groupNoTag')}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <Text size="sm">{item.description}</Text>
                        {reasoningLine ? (
                          <Text size="xs" c="dimmed">
                            est: {reasoningLine}
                          </Text>
                        ) : null}
                      </Stack>
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
                      {isEstimated ? (
                        confirmed ? (
                          <Badge color="green" variant="filled" size="sm" radius="sm">
                            ✓ CONFIRMED
                          </Badge>
                        ) : (
                          <Button
                            size="xs"
                            variant="filled"
                            color="yellow"
                            loading={saving}
                            disabled={saving}
                            onClick={() => {
                              setSavingId(item.id)
                              patch.mutate(
                                { id: item.id, payload: { status: 'EDITED' } },
                                {
                                  onSettled: () => {
                                    setSavingId((id) => (id === item.id ? null : id))
                                  },
                                },
                              )
                            }}
                          >
                            Confirm pending
                          </Button>
                        )
                      ) : flags.length === 0 ? (
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
