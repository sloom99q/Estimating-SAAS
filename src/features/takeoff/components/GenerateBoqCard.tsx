import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Group, List, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import { HttpError } from '@/shared/lib/http/client'
import {
  downloadBoqXlsx,
  fetchJob,
  fetchLatestBoq,
  generateBoq,
  priceBoq,
  startQuantify,
  type BoqCreateResult,
} from '../api/takeoff.api'
import { AddProvisionalLineCard } from './AddProvisionalLineCard'

interface DuplicateTakeoffDetails {
  kind: 'duplicate_takeoff_rows'
  dupGroups: Array<{ category: string; tag: string; count: number; takeoffItemIds: string[] }>
  totalGroups: number
}

function isDuplicateTakeoffError(d: unknown): d is DuplicateTakeoffDetails {
  if (!d || typeof d !== 'object') return false
  const obj = d as Record<string, unknown>
  return obj.kind === 'duplicate_takeoff_rows' && Array.isArray(obj.dupGroups)
}

/**
 * Sprint-8 S8-7 — owner-runnable BOQ flow. Quantify → BOQ → Price → XLSX.
 *
 * Lights up after the extraction pipeline reaches READY. Each click chains
 * the three jobs and updates inline state; on success the XLSX download URL
 * shows next to the button so the user can grab the file.
 */
type Phase = 'idle' | 'quantifying' | 'building' | 'pricing' | 'ready' | 'error'

async function waitForJobDone(jobId: string, pollMs = 1_000, maxTries = 240): Promise<void> {
  for (let i = 0; i < maxTries; i++) {
    const j = await fetchJob(jobId)
    if (j.status === 'DONE') return
    if (j.status === 'FAILED') throw new Error(j.error ?? `${jobId} failed`)
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(`${jobId} timed out after ${maxTries * pollMs / 1000}s`)
}

export function GenerateBoqCard({ projectId, ready }: { projectId: string; ready: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [duplicates, setDuplicates] = useState<DuplicateTakeoffDetails | null>(null)
  const [boq, setBoq] = useState<BoqCreateResult | null>(null)

  // PE-3 — fetch the project's latest BOQ on mount. If one already exists,
  // show the download anchors immediately so the owner can grab the file
  // without re-running Quantify / Price / etc. The existing BOQ is what
  // 6 minutes of tokens already paid for — surfacing it is the right move.
  const existingBoq = useQuery({
    queryKey: ['projects', projectId, 'boq', 'latest'],
    queryFn: () => fetchLatestBoq(projectId),
    enabled: ready && !boq,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (!ready) {
      setPhase('idle')
      setBoq(null)
      setError(null)
      setDuplicates(null)
      return
    }
    // PE-3: as soon as the existing-BOQ query lands, bind to it. The
    // "Generate BOQ + Price" button becomes "Re-run BOQ" and the
    // download anchors appear next to it.
    if (existingBoq.data && !boq) {
      setBoq(existingBoq.data)
      setPhase('ready')
    }
  }, [ready, projectId, existingBoq.data, boq])

  const run = async () => {
    setError(null)
    setDuplicates(null)
    try {
      setPhase('quantifying')
      const { jobId: quantJob } = await startQuantify(projectId)
      await waitForJobDone(quantJob)
      setPhase('building')
      const boqResult = await generateBoq(projectId)
      setBoq(boqResult)
      setPhase('pricing')
      const { jobId: priceJob } = await priceBoq(boqResult.id)
      await waitForJobDone(priceJob)
      setPhase('ready')
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        const details = (err.body as { details?: unknown })?.details
        if (isDuplicateTakeoffError(details)) {
          setDuplicates(details)
          setPhase('error')
          return
        }
      }
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  // PE-2 follow-up — the anchor approach failed because /export.xlsx
  // requires a Bearer token; a bare href opened the URL without auth
  // and the API returned "Missing access token" as JSON. We replace the
  // anchors with buttons that authenticate via fetch and save the
  // returned blob to the user's disk.
  const [downloadingKind, setDownloadingKind] = useState<'client' | 'internal' | null>(null)
  const download = async (kind: 'client' | 'internal') => {
    if (!boq) return
    setDownloadingKind(kind)
    try {
      await downloadBoqXlsx(boq.id, kind === 'internal')
    } catch (err) {
      notifications.show({
        color: 'red',
        title: 'Download failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setDownloadingKind(null)
    }
  }

  const label =
    phase === 'idle'
      ? 'Generate BOQ + Price'
      : phase === 'quantifying'
      ? 'Quantifying…'
      : phase === 'building'
      ? 'Building BOQ…'
      : phase === 'pricing'
      ? 'Pricing…'
      : phase === 'ready'
      ? 'Re-run BOQ'
      : 'Retry'

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Text fw={600}>Bill of Quantities</Text>
        {!ready ? (
          <Text c="dimmed" size="sm">
            Available once the extraction pipeline finishes.
          </Text>
        ) : (
          <Group>
            <Button onClick={run} loading={phase !== 'idle' && phase !== 'ready' && phase !== 'error'}>
              {label}
            </Button>
            {boq && phase === 'ready' ? (
              <>
                <Button
                  variant="light"
                  onClick={() => download('client')}
                  loading={downloadingKind === 'client'}
                  disabled={downloadingKind === 'internal'}
                >
                  Download client XLSX
                </Button>
                <Button
                  variant="subtle"
                  onClick={() => download('internal')}
                  loading={downloadingKind === 'internal'}
                  disabled={downloadingKind === 'client'}
                >
                  Internal-view XLSX
                </Button>
              </>
            ) : null}
          </Group>
        )}
        {boq && phase === 'ready' ? (
          <Text size="sm" c="dimmed">
            BOQ v{boq.version} ready. Subtotal {boq.subtotal ?? '—'} AED · P/S {boq.totalProvisional ?? '—'}.
          </Text>
        ) : null}
        {duplicates ? (
          <Alert color="red" variant="light" title="Duplicate takeoff rows detected — resolve before generating">
            <Stack gap="xs">
              <Text size="sm">
                {duplicates.totalGroups} (category, tag) collision
                {duplicates.totalGroups === 1 ? '' : 's'}. Each takeoff row should be unique —
                edit or soft-delete the duplicates in the review table, then re-try.
              </Text>
              <List size="sm" spacing="xs">
                {duplicates.dupGroups.slice(0, 10).map((g) => (
                  <List.Item key={`${g.category}:${g.tag}`}>
                    <Group gap="xs" wrap="nowrap">
                      <Badge variant="filled" color="red">
                        {g.category}:{g.tag}
                      </Badge>
                      <Text size="sm" c="dimmed">
                        ×{g.count} —
                      </Text>
                      <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                        {g.takeoffItemIds.join(', ')}
                      </Text>
                    </Group>
                  </List.Item>
                ))}
              </List>
              {duplicates.totalGroups > 10 ? (
                <Text size="xs" c="dimmed">
                  …+{duplicates.totalGroups - 10} more
                </Text>
              ) : null}
            </Stack>
          </Alert>
        ) : null}
        {error ? (
          <Text size="sm" c="red">
            {error}
          </Text>
        ) : null}
        {boq && phase === 'ready' ? (
          <AddProvisionalLineCard boqId={boq.id} projectId={projectId} />
        ) : null}
      </Stack>
    </Card>
  )
}
