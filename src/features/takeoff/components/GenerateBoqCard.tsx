import { useEffect, useState } from 'react'
import { Anchor, Button, Card, Group, Stack, Text } from '@mantine/core'
import {
  fetchJob,
  generateBoq,
  priceBoq,
  startQuantify,
  xlsxDownloadUrl,
  type BoqCreateResult,
} from '../api/takeoff.api'

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
  const [boq, setBoq] = useState<BoqCreateResult | null>(null)

  useEffect(() => {
    if (!ready) {
      setPhase('idle')
      setBoq(null)
      setError(null)
    }
  }, [ready, projectId])

  const run = async () => {
    setError(null)
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
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  const downloadUrl = boq ? xlsxDownloadUrl(boq.id) : null
  const internalUrl = boq ? xlsxDownloadUrl(boq.id, true) : null

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
            {downloadUrl && phase === 'ready' ? (
              <Anchor href={downloadUrl} target="_blank" rel="noreferrer">
                Download client XLSX
              </Anchor>
            ) : null}
            {internalUrl && phase === 'ready' ? (
              <Anchor href={internalUrl} target="_blank" rel="noreferrer">
                Internal-view XLSX
              </Anchor>
            ) : null}
          </Group>
        )}
        {boq && phase === 'ready' ? (
          <Text size="sm" c="dimmed">
            BOQ v{boq.version} ready. Subtotal {boq.subtotal ?? '—'} AED · P/S {boq.totalProvisional ?? '—'}.
          </Text>
        ) : null}
        {error ? (
          <Text size="sm" c="red">
            {error}
          </Text>
        ) : null}
      </Stack>
    </Card>
  )
}
