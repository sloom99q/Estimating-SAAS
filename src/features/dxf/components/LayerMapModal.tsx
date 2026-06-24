/**
 * DXF MVP — LayerMapModal.
 *
 * Opens on first DXF upload in a project (or when re-edited). Reads
 * the LayerReport from the introspect endpoint, renders one Select
 * per LayerMap role pre-populated with the AIA-NCS-suggested layer,
 * lets the user override, and PATCHes the map back. Optionally
 * checks "save as my firm's default" to copy the map onto the
 * Organization for future projects.
 *
 * Why this UX (not auto-and-go): the parser cannot reliably tell
 * which non-AIA layer holds rooms in an unfamiliar file. Guessing
 * wrong = zero rooms extracted, silently. The cost of that failure
 * mode is so high — one wasted project, no visible error — that
 * paying one extra click on the first upload from each firm is the
 * obvious trade. After this, the project's saved map drives every
 * subsequent DXF and the modal stays out of the way.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchLayerMap,
  fetchLayerReport,
  saveLayerMap,
  type LayerMap,
  type LayerSummary,
} from '../api/dxf.api'

interface Props {
  opened: boolean
  onClose: () => void
  projectId: string
  documentId: string
  filename: string
}

interface FormState {
  roomBounds: string
  roomLabels: string
  doors: string
  windows: string
  walls: string
  minRoomAreaM2: number
  maxRoomAreaM2: number
  saveAsOrgDefault: boolean
}

const ROLE_LABELS: Record<keyof FormState, string> = {
  roomBounds: 'Room boundary layer (closed polylines)',
  roomLabels: 'Room label layer (TEXT / MTEXT)',
  doors: 'Door layer (INSERT block refs)',
  windows: 'Window / glazing layer (INSERT block refs)',
  walls: 'Wall layer (LINE / open polyline) — for paint, phase 2',
  minRoomAreaM2: '',
  maxRoomAreaM2: '',
  saveAsOrgDefault: '',
}

export function LayerMapModal({ opened, onClose, projectId, documentId, filename }: Props) {
  const qc = useQueryClient()

  const reportQ = useQuery({
    queryKey: ['dxf', 'report', projectId, documentId],
    queryFn: () => fetchLayerReport(projectId, documentId),
    enabled: opened,
  })

  const mapQ = useQuery({
    queryKey: ['dxf', 'layerMap', projectId],
    queryFn: () => fetchLayerMap(projectId),
    enabled: opened,
  })

  const [state, setState] = useState<FormState>({
    roomBounds: '',
    roomLabels: '',
    doors: '',
    windows: '',
    walls: '',
    minRoomAreaM2: 0.8,
    maxRoomAreaM2: 500,
    saveAsOrgDefault: false,
  })

  // When the report + map land, pre-fill the form. Preference:
  //  1. existing project.layerMap (re-open editing case)
  //  2. org.defaultLayerMap (firm has a saved default)
  //  3. report.suggested (AIA-NCS auto-detect)
  useEffect(() => {
    if (!reportQ.data || !mapQ.data) return
    const layers = reportQ.data.report.layers.map((l) => l.name)
    const sug = reportQ.data.report.suggested
    const seed = mapQ.data.layerMap ?? mapQ.data.orgDefault
    const pick = (
      existing: string[] | undefined,
      suggested: string[],
      defaultIdx = 0,
    ): string => {
      // Use first existing-in-this-file entry, else first suggested,
      // else blank (forces user to pick).
      const fromExisting = existing?.find((n) => layers.includes(n))
      if (fromExisting) return fromExisting
      return suggested[defaultIdx] ?? ''
    }
    setState({
      roomBounds: pick(seed?.roomBounds, sug.roomBounds),
      roomLabels: pick(seed?.roomLabels, sug.roomLabels),
      doors: pick(seed?.doors, sug.doors),
      windows: pick(seed?.windows, sug.windows),
      walls: pick(seed?.walls, sug.walls),
      minRoomAreaM2: seed?.minRoomAreaM2 ?? mapQ.data.aiaDefault.minRoomAreaM2,
      maxRoomAreaM2: seed?.maxRoomAreaM2 ?? mapQ.data.aiaDefault.maxRoomAreaM2,
      saveAsOrgDefault: false,
    })
  }, [reportQ.data, mapQ.data])

  const layerOptions = useMemo(() => {
    if (!reportQ.data) return []
    return reportQ.data.report.layers.map((l) => ({
      value: l.name,
      label: `${l.name}  (${l.entityCount} entit${l.entityCount === 1 ? 'y' : 'ies'})`,
    }))
  }, [reportQ.data])

  const layerByName = useMemo(() => {
    const m = new Map<string, LayerSummary>()
    for (const l of reportQ.data?.report.layers ?? []) m.set(l.name, l)
    return m
  }, [reportQ.data])

  // Live preview of what would extract under the chosen layer picks.
  const preview = useMemo(() => {
    const rb = layerByName.get(state.roomBounds)
    const rl = layerByName.get(state.roomLabels)
    const dr = layerByName.get(state.doors)
    const wn = layerByName.get(state.windows)
    return {
      rooms: rb?.closedPolylineCount ?? 0,
      labels: rl?.textCount ?? 0,
      doors: dr?.entityTypes['INSERT'] ?? 0,
      windows: wn?.entityTypes['INSERT'] ?? 0,
    }
  }, [layerByName, state.roomBounds, state.roomLabels, state.doors, state.windows])

  const saveMut = useMutation({
    mutationFn: async () => {
      const layerMap: LayerMap = {
        roomBounds: [state.roomBounds].filter(Boolean),
        roomLabels: [state.roomLabels].filter(Boolean),
        doors: [state.doors].filter(Boolean),
        windows: [state.windows].filter(Boolean),
        walls: [state.walls].filter(Boolean),
        tagAttribs: mapQ.data?.aiaDefault.tagAttribs ?? ['TAG', 'MARK', 'TYPE', 'ID'],
        minRoomAreaM2: state.minRoomAreaM2,
        maxRoomAreaM2: state.maxRoomAreaM2,
      }
      return saveLayerMap(projectId, {
        layerMap,
        saveAsOrgDefault: state.saveAsOrgDefault,
        enqueueDocumentId: documentId,
      })
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['dxf', 'layerMap', projectId] })
      notifications.show({
        color: res.parseDxfQueued ? 'green' : 'yellow',
        title: 'Layer map saved',
        message: res.parseDxfQueued
          ? `PARSE_DXF queued (job ${res.parseDxfJobId?.slice(-8)}). Extraction starts on the next worker tick.`
          : 'Saved. PARSE_DXF handler is not implemented yet — extraction queued for the next build phase.',
      })
      onClose()
    },
    onError: (err) => {
      notifications.show({
        color: 'red',
        title: 'Save failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    },
  })

  const canSave =
    state.roomBounds.length > 0 &&
    state.doors.length > 0 &&
    state.windows.length > 0 &&
    state.minRoomAreaM2 < state.maxRoomAreaM2

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Title order={4}>Confirm DXF layer mapping</Title>}
      size="xl"
      closeOnClickOutside={false}
      closeOnEscape={false}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          <strong>{filename}</strong> — pick which DXF layer holds each kind of entity.
          The AIA-NCS-derived defaults below were guessed from the file's layer names; if
          your firm uses a different convention, override here. Saved per project, with
          an optional org-level default for next time.
        </Text>

        {reportQ.isLoading || mapQ.isLoading ? (
          <Text>Reading layers…</Text>
        ) : reportQ.error ? (
          <Alert color="red" variant="light">
            Failed to introspect DXF: {String(reportQ.error)}
          </Alert>
        ) : !reportQ.data?.report.ok ? (
          <Alert color="red" variant="light">
            DXF parse failed: {reportQ.data?.report.error}
          </Alert>
        ) : (
          <>
            <Group gap="xs" wrap="wrap">
              <Badge variant="light">{reportQ.data.report.totalLayers} layers</Badge>
              <Badge variant="light">{reportQ.data.report.totalEntities} entities</Badge>
              <Badge variant="light">
                units = {reportQ.data.report.insUnits === 4 ? 'mm ✓' : `${reportQ.data.report.insUnits ?? '?'} (expected 4=mm)`}
              </Badge>
            </Group>

            {/* Layer table for transparency — the user can see exactly
                what's on each layer before picking. */}
            <Table.ScrollContainer minWidth={600}>
              <Table withTableBorder withColumnBorders striped highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Layer</Table.Th>
                    <Table.Th>Entities</Table.Th>
                    <Table.Th>Types</Table.Th>
                    <Table.Th>Top INSERT blocks</Table.Th>
                    <Table.Th>Auto-detected roles</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {reportQ.data.report.layers
                    .filter((l) => l.entityCount > 0)
                    .map((l) => (
                      <Table.Tr key={l.name}>
                        <Table.Td>
                          <Text ff="monospace" size="sm" fw={600}>
                            {l.name}
                          </Text>
                        </Table.Td>
                        <Table.Td className="app-numeric">{l.entityCount}</Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {Object.entries(l.entityTypes)
                              .map(([t, n]) => `${t}:${n}`)
                              .join('  ')}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {l.insertBlockNames.join(', ') || '—'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4}>
                            {l.matchedRoles.length === 0 ? (
                              <Text size="xs" c="dimmed">
                                —
                              </Text>
                            ) : (
                              l.matchedRoles.map((r) => (
                                <Badge
                                  key={r}
                                  size="xs"
                                  color={
                                    r === 'roomBounds'
                                      ? 'blue'
                                      : r === 'doors'
                                      ? 'green'
                                      : r === 'windows'
                                      ? 'cyan'
                                      : r === 'walls'
                                      ? 'orange'
                                      : 'gray'
                                  }
                                  variant="light"
                                >
                                  {r}
                                </Badge>
                              ))
                            )}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>

            <Stack gap="xs">
              {(['roomBounds', 'roomLabels', 'doors', 'windows', 'walls'] as const).map(
                (role) => (
                  <Select
                    key={role}
                    label={ROLE_LABELS[role]}
                    description={
                      reportQ.data!.report.suggested[role].length === 0
                        ? 'No auto-detected candidate — pick manually'
                        : `Suggested: ${reportQ.data!.report.suggested[role].join(', ')}`
                    }
                    placeholder="Pick a layer"
                    data={layerOptions}
                    value={state[role]}
                    onChange={(v) => setState((s) => ({ ...s, [role]: v ?? '' }))}
                    searchable
                    clearable
                    nothingFoundMessage="No matching layer"
                  />
                ),
              )}
            </Stack>

            <Group grow>
              <NumberInput
                label="Min room area (m²) — drops smaller polygons as furniture"
                value={state.minRoomAreaM2}
                onChange={(v) =>
                  setState((s) => ({ ...s, minRoomAreaM2: typeof v === 'number' ? v : 0.8 }))
                }
                min={0}
                max={50}
                step={0.1}
                decimalScale={1}
              />
              <NumberInput
                label="Max room area (m²) — drops larger polygons as plot/outline"
                value={state.maxRoomAreaM2}
                onChange={(v) =>
                  setState((s) => ({ ...s, maxRoomAreaM2: typeof v === 'number' ? v : 500 }))
                }
                min={50}
                max={10_000}
                step={50}
              />
            </Group>

            <Alert color="blue" variant="light" title="Preview — what would extract">
              Rooms (closed polygons): <strong>{preview.rooms}</strong> · room labels:{' '}
              <strong>{preview.labels}</strong> · doors: <strong>{preview.doors}</strong>{' '}
              · windows: <strong>{preview.windows}</strong>
            </Alert>

            <Checkbox
              label="Save these layer choices as my firm's default for new projects"
              checked={state.saveAsOrgDefault}
              onChange={(e) =>
                setState((s) => ({ ...s, saveAsOrgDefault: e.currentTarget.checked }))
              }
            />
          </>
        )}

        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={!canSave}
            loading={saveMut.isPending}
          >
            Save layer map &amp; queue PARSE_DXF
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
