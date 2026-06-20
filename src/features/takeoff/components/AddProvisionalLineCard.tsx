import { useEffect, useState } from 'react'
import {
  ActionIcon,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addProvisionalBoqLine,
  deleteBoqLine,
  fetchBoqSections,
  fetchProvisionalLines,
  patchBoqLine,
  type AddProvisionalLinePayload,
  type ExistingProvisionalLine,
} from '../api/takeoff.api'

/**
 * Roadmap #5 + #128 — let the estimator carry architect-side P/S lines
 * (windows, lighting, cladding, facade, MEP) AND edit / delete what
 * they've already added.
 *
 * Section 4.0 Provisional Sums is always auto-created by the BOQ
 * generator (roadmap #5), so this card always has somewhere to write.
 * Existing P/S lines render in a small table below the header with
 * inline edit + delete affordances.
 */
type ModalMode =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; line: ExistingProvisionalLine }

const PROVISIONAL_LINES_KEY = (boqId: string) => ['boqs', boqId, 'provisional-lines'] as const

export function AddProvisionalLineCard({
  boqId,
  projectId,
}: {
  boqId: string
  projectId: string
}) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<ModalMode>({ kind: 'closed' })
  const [sectionId, setSectionId] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [unit, setUnit] = useState('item')
  const [qty, setQty] = useState<number | string>(1)
  const [psAmount, setPsAmount] = useState<number | string>(0)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const existingLines = useQuery({
    queryKey: PROVISIONAL_LINES_KEY(boqId),
    queryFn: () => fetchProvisionalLines(boqId),
    enabled: !!boqId,
  })

  const sections = useQuery({
    queryKey: ['boqs', boqId, 'sections'],
    queryFn: () => fetchBoqSections(boqId),
    enabled: !!boqId && mode.kind !== 'closed',
  })

  const resetForm = () => {
    setDescription('')
    setUnit('item')
    setQty(1)
    setPsAmount(0)
    setSectionId(null)
  }

  const openAdd = () => {
    resetForm()
    setMode({ kind: 'add' })
  }

  const openEdit = (line: ExistingProvisionalLine) => {
    setDescription(line.description)
    setUnit(line.unit)
    setQty(line.qty)
    setPsAmount(line.psAmount)
    setSectionId(line.sectionId)
    setMode({ kind: 'edit', line })
  }

  const close = () => {
    if (saving) return
    setMode({ kind: 'closed' })
  }

  // Auto-default new lines to Section 4.0 once sections load.
  useEffect(() => {
    if (mode.kind !== 'add' || sectionId !== null) return
    if (!sections.data) return
    const ps = sections.data.find((s) => s.code === '4.0')
    if (ps) setSectionId(ps.id)
  }, [mode, sectionId, sections.data])

  const submit = async () => {
    const psNum = Number(psAmount)
    const qtyNum = Number(qty)
    if (!description.trim() || !unit.trim() || !Number.isFinite(qtyNum) || qtyNum < 0) return
    if (!Number.isFinite(psNum) || psNum < 0) return
    setSaving(true)
    try {
      if (mode.kind === 'add') {
        if (!sectionId) return
        const payload: AddProvisionalLinePayload = {
          description: description.trim(),
          unit: unit.trim(),
          qty: qtyNum,
          psAmount: psNum,
        }
        await addProvisionalBoqLine(boqId, sectionId, payload)
        notifications.show({
          color: 'green',
          title: 'Provisional line added',
          message: `${payload.description} — P/S ${psNum.toLocaleString('en-AE')} AED`,
        })
      } else if (mode.kind === 'edit') {
        await patchBoqLine(boqId, mode.line.id, {
          description: description.trim(),
          qty: qtyNum,
          psAmount: psNum,
        })
        notifications.show({
          color: 'green',
          title: 'Provisional line updated',
          message: `${mode.line.itemRef} — now P/S ${psNum.toLocaleString('en-AE')} AED`,
        })
      }
      await qc.invalidateQueries({ queryKey: PROVISIONAL_LINES_KEY(boqId) })
      await qc.invalidateQueries({ queryKey: ['projects', projectId, 'boq', 'latest'] })
      await qc.invalidateQueries({ queryKey: ['boqs', boqId] })
      setMode({ kind: 'closed' })
    } catch (err) {
      notifications.show({
        color: 'red',
        title: mode.kind === 'add' ? 'Add provisional line failed' : 'Update failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (line: ExistingProvisionalLine) => {
    if (!window.confirm(`Delete ${line.itemRef} — "${line.description}" (P/S ${line.psAmount.toLocaleString('en-AE')} AED)?`)) {
      return
    }
    setDeletingId(line.id)
    try {
      await deleteBoqLine(boqId, line.id)
      notifications.show({
        color: 'green',
        title: 'Provisional line deleted',
        message: `${line.itemRef} removed; BOQ totals updated`,
      })
      await qc.invalidateQueries({ queryKey: PROVISIONAL_LINES_KEY(boqId) })
      await qc.invalidateQueries({ queryKey: ['projects', projectId, 'boq', 'latest'] })
      await qc.invalidateQueries({ queryKey: ['boqs', boqId] })
    } catch (err) {
      notifications.show({
        color: 'red',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setDeletingId(null)
    }
  }

  const lines = existingLines.data ?? []
  const sectionLabel = (s: { code: string; title: string }) => `${s.code} — ${s.title}`

  return (
    <>
      <Card withBorder>
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Stack gap={2}>
              <Text fw={600}>Provisional sums</Text>
              <Text size="xs" c="dimmed">
                Add architect-side carries the drawing doesn't measure: windows P/S,
                lighting, cladding, façade, MEP containment. Edit / delete inline if a number
                changes.
              </Text>
            </Stack>
            <Button onClick={openAdd}>+ Add provisional line</Button>
          </Group>

          {existingLines.isLoading ? (
            <Text size="sm" c="dimmed">
              Loading existing provisional lines…
            </Text>
          ) : lines.length === 0 ? (
            <Text size="sm" c="dimmed">
              No provisional lines yet. Add the first one above.
            </Text>
          ) : (
            <Table withTableBorder withColumnBorders highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 100 }}>Ref</Table.Th>
                  <Table.Th>Description</Table.Th>
                  <Table.Th style={{ width: 70 }}>Unit</Table.Th>
                  <Table.Th style={{ width: 90 }}>Qty</Table.Th>
                  <Table.Th style={{ width: 150 }}>P/S (AED)</Table.Th>
                  <Table.Th style={{ width: 110 }}>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lines.map((l) => (
                  <Table.Tr key={l.id}>
                    <Table.Td>
                      <Text size="sm" className="app-numeric">
                        {l.itemRef}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{l.description}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{l.unit}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" className="app-numeric">
                        {l.qty.toLocaleString('en-AE')}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" className="app-numeric">
                        {l.psAmount.toLocaleString('en-AE', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={6}>
                        <Tooltip label="Edit this line">
                          <ActionIcon
                            variant="light"
                            color="blue"
                            size="sm"
                            onClick={() => openEdit(l)}
                            disabled={deletingId === l.id}
                          >
                            ✎
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Delete this line">
                          <ActionIcon
                            variant="light"
                            color="red"
                            size="sm"
                            loading={deletingId === l.id}
                            onClick={() => remove(l)}
                          >
                            ✕
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Card>

      <Modal
        opened={mode.kind !== 'closed'}
        onClose={close}
        title={mode.kind === 'edit' ? `Edit ${mode.line.itemRef}` : 'Add provisional line'}
        centered
      >
        <Stack gap="sm">
          {mode.kind === 'add' ? (
            <Select
              label="Section"
              placeholder={sections.isLoading ? 'Loading sections…' : 'Pick a section'}
              data={(sections.data ?? []).map((s) => ({
                value: s.id,
                label: sectionLabel(s),
              }))}
              value={sectionId}
              onChange={setSectionId}
              disabled={saving || sections.isLoading}
              searchable
              comboboxProps={{ withinPortal: true }}
            />
          ) : null}
          <TextInput
            label="Description"
            placeholder="e.g. Glazing supply & install — all units"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            disabled={saving}
            required
          />
          <Group grow>
            <TextInput
              label="Unit"
              placeholder="item / No / m² / lm / sum"
              value={unit}
              onChange={(e) => setUnit(e.currentTarget.value)}
              disabled={saving || mode.kind === 'edit'}
              required
            />
            <NumberInput
              label="Quantity"
              value={qty}
              onChange={(v) => setQty(v as number | string)}
              min={0}
              decimalScale={4}
              disabled={saving}
            />
          </Group>
          <NumberInput
            label="P/S amount (AED)"
            value={psAmount}
            onChange={(v) => setPsAmount(v as number | string)}
            min={0}
            decimalScale={2}
            thousandSeparator=","
            disabled={saving}
            required
          />
          <Group justify="flex-end" mt="sm">
            <Button variant="subtle" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              loading={saving}
              disabled={
                (mode.kind === 'add' && !sectionId) ||
                description.trim() === '' ||
                unit.trim() === '' ||
                !Number.isFinite(Number(psAmount)) ||
                Number(psAmount) < 0
              }
            >
              {mode.kind === 'edit' ? 'Save changes' : 'Add line'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
