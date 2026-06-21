import { useEffect, useRef, useState } from 'react'
import { Button, Card, Group, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import { fetchJob, startEstimateWardrobes } from '../api/takeoff.api'
import { TAKEOFF_KEYS } from '../api/useTakeoff'

/**
 * AI-est roadmap #4a — opt-in wardrobe estimate. ONE Opus call per
 * bedroom; cost scales (~$0.05 per bedroom = $0.25 for a 5-bedroom
 * villa). Suggestions land in JOINERY for the expert to Confirm.
 *
 * Wardrobes are the LOWEST-reliability category yet (raw 40-55%) —
 * the card's copy is explicit so the user reads the reasoning, not
 * the number.
 *
 * Polling (2026-06-21 expert-flagged stuck-button fix):
 *   pollMs=2_000, maxTries=300 → 10 min wall-clock ceiling. The
 *   wardrobe job scales with bedroom count (5 bedrooms × ~15 s Opus
 *   each ≈ 80 s typical, but a 10-bedroom mansion + slow Opus run
 *   could push 5-7 min). The polling-onsuccess + finally{setRunning(false)}
 *   already releases the button on completion — the prior 3-min cap
 *   was just too tight for big runs.
 */
async function waitForJobDone(
  jobId: string,
  onTick: (elapsedSec: number) => void,
  pollMs = 2_000,
  maxTries = 300,
): Promise<void> {
  const start = Date.now()
  for (let i = 0; i < maxTries; i += 1) {
    const j = await fetchJob(jobId)
    if (j.status === 'DONE') return
    if (j.status === 'FAILED') throw new Error(j.error ?? `${jobId} failed`)
    onTick(Math.floor((Date.now() - start) / 1000))
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(`Estimate wardrobes timed out after ${(maxTries * pollMs) / 1000}s — job may still be running on the server; check JOINERY after a minute`)
}

export function EstimateWardrobesCard({ projectId, ready }: { projectId: string; ready: boolean }) {
  const qc = useQueryClient()
  const [running, setRunning] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)

  // Belt-and-braces: if the component unmounts mid-run, don't try to
  // setState on a dead instance. Tracked via a ref the run() loop reads.
  const aliveRef = useRef(true)
  useEffect(() => () => {
    aliveRef.current = false
  }, [])

  const run = async () => {
    if (running) return
    setRunning(true)
    setElapsedSec(0)
    try {
      const { jobId } = await startEstimateWardrobes(projectId)
      await waitForJobDone(jobId, (s) => {
        if (aliveRef.current) setElapsedSec(s)
      })
      await qc.invalidateQueries({ queryKey: TAKEOFF_KEYS.project(projectId) })
      if (aliveRef.current) {
        notifications.show({
          color: 'green',
          title: 'Wardrobes estimated',
          message: 'See JOINERY in the review table. Read the hatching-pattern field before confirming each.',
        })
      }
    } catch (err) {
      if (aliveRef.current) {
        notifications.show({
          color: 'red',
          title: 'Estimate wardrobes failed',
          message: err instanceof Error ? err.message : 'Unknown error',
        })
        // Even on failure / timeout, invalidate the bundle so any rows
        // that DID land server-side surface in the review table.
        await qc.invalidateQueries({ queryKey: TAKEOFF_KEYS.project(projectId) })
      }
    } finally {
      if (aliveRef.current) {
        setRunning(false)
        setElapsedSec(0)
      }
    }
  }

  if (!ready) return null

  return (
    <Card withBorder>
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Text fw={600}>Optional: AI wardrobe estimate</Text>
          <Text size="xs" c="dimmed">
            Reads each bedroom on the floor plan and proposes wardrobe linear meters with the
            hatching pattern actually seen. Lowest-reliability category yet (raw 40-55%) — the
            reasoning + hatching fields matter more than the number. Costs ~$0.05 per bedroom in
            API tokens. NO joinery rate assumed: lines enter the BOQ as P/S with the lm count,
            you type the per-lm rate.
          </Text>
        </Stack>
        <Stack gap={4} align="flex-end">
          <Button onClick={run} loading={running}>
            Estimate wardrobes
          </Button>
          {running && elapsedSec > 0 ? (
            <Text size="xs" c="dimmed">
              {elapsedSec}s elapsed — Opus call per bedroom
            </Text>
          ) : null}
        </Stack>
      </Group>
    </Card>
  )
}
