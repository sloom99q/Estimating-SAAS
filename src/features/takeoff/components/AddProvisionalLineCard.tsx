import { useState } from 'react'
import {
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addProvisionalBoqLine,
  fetchBoqSections,
  type AddProvisionalLinePayload,
} from '../api/takeoff.api'

/**
 * Roadmap #5 — let the estimator carry the architect-side line items the
 * drawing doesn't measure (windows P/S, lighting, cladding, facade, MEP
 * containment). POSTs to the existing PB-1 add-line endpoint as a
 * provisional carry. Section 4.0 is always auto-created by the BOQ
 * generator so this button always has somewhere to write.
 *
 * Closed by default so a fresh-eyes user sees just the Generate / Download
 * buttons; opens into a modal with the four fields that matter:
 *   - section (defaults to 4.0 Provisional Sums)
 *   - description (the carry's name, e.g. "Glazing supply & install")
 *   - unit + qty (carry can be "1 item" or "20 No" — estimator's choice)
 *   - psAmount (the carry total in AED)
 */
export function AddProvisionalLineCard({
  boqId,
  projectId,
}: {
  boqId: string
  projectId: string
}) {
  const qc = useQueryClient()
  const [opened, setOpened] = useState(false)
  const [sectionId, setSectionId] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [unit, setUnit] = useState('item')
  const [qty, setQty] = useState<number | string>(1)
  const [psAmount, setPsAmount] = useState<number | string>(0)
  const [saving, setSaving] = useState(false)

  const sections = useQuery({
    queryKey: ['boqs', boqId, 'sections'],
    queryFn: () => fetchBoqSections(boqId),
    enabled: !!boqId && opened,
  })

  const reset = () => {
    setDescription('')
    setUnit('item')
    setQty(1)
    setPsAmount(0)
    setSectionId(null)
  }

  const open = () => {
    reset()
    setOpened(true)
  }

  const close = () => {
    if (saving) return
    setOpened(false)
  }

  const submit = async () => {
    if (!sectionId) return
    const psNum = Number(psAmount)
    const qtyNum = Number(qty)
    if (!description.trim() || !unit.trim() || !Number.isFinite(qtyNum) || qtyNum < 0) return
    if (!Number.isFinite(psNum) || psNum < 0) return
    const payload: AddProvisionalLinePayload = {
      description: description.trim(),
      unit: unit.trim(),
      qty: qtyNum,
      psAmount: psNum,
    }
    setSaving(true)
    try {
      await addProvisionalBoqLine(boqId, sectionId, payload)
      notifications.show({
        color: 'green',
        title: 'Provisional line added',
        message: `${payload.description} — P/S ${psNum.toLocaleString('en-AE')} AED`,
      })
      await qc.invalidateQueries({ queryKey: ['projects', projectId, 'boq', 'latest'] })
      await qc.invalidateQueries({ queryKey: ['boqs', boqId] })
      setOpened(false)
    } catch (err) {
      notifications.show({
        color: 'red',
        title: 'Add provisional line failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card withBorder>
        <Group justify="space-between" align="center">
          <Stack gap={2}>
            <Text fw={600}>Provisional sums</Text>
            <Text size="xs" c="dimmed">
              Add architect-side carries the drawing doesn't measure: windows P/S,
              lighting, cladding, façade, MEP containment.
            </Text>
          </Stack>
          <Button onClick={open}>+ Add provisional line</Button>
        </Group>
      </Card>

      <Modal opened={opened} onClose={close} title="Add provisional line" centered>
        <Stack gap="sm">
          <Select
            label="Section"
            placeholder={sections.isLoading ? 'Loading sections…' : 'Pick a section'}
            data={(sections.data ?? []).map((s) => ({
              value: s.id,
              label: `${s.code} — ${s.title}`,
            }))}
            value={sectionId}
            onChange={setSectionId}
            disabled={saving || sections.isLoading}
            searchable
            // Default selection — 4.0 Provisional Sums when loaded
            onDropdownOpen={() => {
              if (!sectionId && sections.data) {
                const ps = sections.data.find((s) => s.code === '4.0')
                if (ps) setSectionId(ps.id)
              }
            }}
            // Auto-default on first render once sections load
            comboboxProps={{ withinPortal: true }}
          />
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
              disabled={saving}
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
                !sectionId ||
                description.trim() === '' ||
                unit.trim() === '' ||
                !Number.isFinite(Number(psAmount)) ||
                Number(psAmount) < 0
              }
            >
              Add line
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
