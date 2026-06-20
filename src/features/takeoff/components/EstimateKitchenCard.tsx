import { useState } from 'react'
import { Button, Card, Group, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import { fetchJob, startEstimateKitchen } from '../api/takeoff.api'
import { TAKEOFF_KEYS } from '../api/useTakeoff'

/**
 * AI-est roadmap #3 — opt-in kitchen estimate. Costs ~$0.01 per click
 * in API tokens. Suggestions land in JOINERY for the expert to Confirm.
 *
 * Sits next to the BOQ controls — only ever runs when this button is
 * clicked. No automatic chain, no cold-upload billing.
 */
async function waitForJobDone(jobId: string, pollMs = 1_000, maxTries = 90): Promise<void> {
  for (let i = 0; i < maxTries; i += 1) {
    const j = await fetchJob(jobId)
    if (j.status === 'DONE') return
    if (j.status === 'FAILED') throw new Error(j.error ?? `${jobId} failed`)
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(`Estimate kitchen timed out after ${(maxTries * pollMs) / 1000}s`)
}

export function EstimateKitchenCard({ projectId, ready }: { projectId: string; ready: boolean }) {
  const qc = useQueryClient()
  const [running, setRunning] = useState(false)

  const run = async () => {
    if (running) return
    setRunning(true)
    try {
      const { jobId } = await startEstimateKitchen(projectId)
      await waitForJobDone(jobId)
      await qc.invalidateQueries({ queryKey: TAKEOFF_KEYS.project(projectId) })
      notifications.show({
        color: 'green',
        title: 'Kitchen estimated',
        message: 'See JOINERY section in the review table. Confirm each line after expert review.',
      })
    } catch (err) {
      notifications.show({
        color: 'red',
        title: 'Estimate kitchen failed',
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
          <Text fw={600}>Optional: AI kitchen estimate</Text>
          <Text size="xs" c="dimmed">
            Reads the kitchen region of the floor plan and proposes base + wall cabinet
            linear meters. ~$0.01 per click in API tokens. Suggestions land in JOINERY for your
            confirm — never auto-priced. Confidence is capped at 60 until validated across
            more kitchens.
          </Text>
        </Stack>
        <Button onClick={run} loading={running}>
          Estimate kitchen
        </Button>
      </Group>
    </Card>
  )
}
