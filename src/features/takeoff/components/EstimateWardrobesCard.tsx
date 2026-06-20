import { useState } from 'react'
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
 */
async function waitForJobDone(jobId: string, pollMs = 1_500, maxTries = 120): Promise<void> {
  for (let i = 0; i < maxTries; i += 1) {
    const j = await fetchJob(jobId)
    if (j.status === 'DONE') return
    if (j.status === 'FAILED') throw new Error(j.error ?? `${jobId} failed`)
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(`Estimate wardrobes timed out after ${(maxTries * pollMs) / 1000}s`)
}

export function EstimateWardrobesCard({ projectId, ready }: { projectId: string; ready: boolean }) {
  const qc = useQueryClient()
  const [running, setRunning] = useState(false)

  const run = async () => {
    if (running) return
    setRunning(true)
    try {
      const { jobId } = await startEstimateWardrobes(projectId)
      await waitForJobDone(jobId)
      await qc.invalidateQueries({ queryKey: TAKEOFF_KEYS.project(projectId) })
      notifications.show({
        color: 'green',
        title: 'Wardrobes estimated',
        message: 'See JOINERY in the review table. Read the hatching-pattern field before confirming each.',
      })
    } catch (err) {
      notifications.show({
        color: 'red',
        title: 'Estimate wardrobes failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setRunning(false)
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
        <Button onClick={run} loading={running}>
          Estimate wardrobes
        </Button>
      </Group>
    </Card>
  )
}
