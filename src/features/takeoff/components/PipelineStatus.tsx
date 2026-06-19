import { Alert, Badge, Button, Card, Group, Progress, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { retryJob, type DocumentBundle, type JobDto } from '../api/takeoff.api'

// Sprint-8 S8-7: include EXTRACT_FINISH_LEGEND (Sprint 6 stage). The Sprint 5
// stepper omitted it because the stage didn't exist when this list was first
// drafted; the SPA showed 4/4 done even while the legend step was still
// running.
const STAGES = [
  'INGEST',
  'CLASSIFY',
  'EXTRACT_FINISH_LEGEND',
  'EXTRACT_SCHEDULES',
  'EXTRACT_ROOMS',
] as const

function statusColor(s: JobDto['status']): string {
  if (s === 'DONE') return 'green'
  if (s === 'RUNNING') return 'blue'
  if (s === 'FAILED') return 'red'
  return 'gray'
}

/**
 * PB-3 — pick the LATEST job per type, preferring DONE over RUNNING over
 * QUEUED over FAILED. The double-chain run on doc cmqbjjudp… left a
 * stale FAILED CLASSIFY *next to* a DONE CLASSIFY, and the prior
 * implementation (just-take-the-first-after-desc-sort) picked whichever
 * the backend returned first. The new tie-breaker is status-priority
 * → createdAt desc, so the user-visible state reflects the latest
 * SUCCESSFUL stage, not a stale failure.
 */
const STATUS_PRIORITY: Record<JobDto['status'], number> = {
  DONE: 4,
  RUNNING: 3,
  QUEUED: 2,
  FAILED: 1,
}
function latestByType(jobs: JobDto[]): Record<string, JobDto> {
  const map: Record<string, JobDto> = {}
  for (const j of jobs) {
    const existing = map[j.type]
    if (!existing) {
      map[j.type] = j
      continue
    }
    const pNew = STATUS_PRIORITY[j.status] ?? 0
    const pExisting = STATUS_PRIORITY[existing.status] ?? 0
    if (pNew > pExisting) map[j.type] = j
    else if (pNew === pExisting) {
      // same status — keep the more recent one
      if (j.createdAt > existing.createdAt) map[j.type] = j
    }
  }
  return map
}

export function PipelineStatus({ bundle }: { bundle: DocumentBundle }) {
  const { t } = useTranslation('takeoff')
  const qc = useQueryClient()
  // Sprint-10 PA-2 — Retry a FAILED pipeline stage. Re-enqueues only
  // that stage; downstream stages chain on completion thanks to the
  // chainGuard (idempotency standing rule).
  const retryMutation = useMutation({
    mutationFn: (jobId: string) => retryJob(jobId),
    onSuccess: (j) => {
      notifications.show({
        color: 'green',
        title: 'Stage re-enqueued',
        message: `${j.type} is queued — the worker will pick it up shortly.`,
      })
      void qc.invalidateQueries({ queryKey: ['documents', bundle.document.id] })
    },
    onError: (err) => {
      notifications.show({
        color: 'red',
        title: 'Retry failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    },
  })
  const latest = latestByType(bundle.jobs)
  const done = STAGES.filter((s) => latest[s]?.status === 'DONE').length
  const total = STAGES.length
  // P-package P-TOP — derive provenance from DATA, not from env. Show a
  // banner for *both* sides: yellow STUB DATA when any job ran with
  // aiMode=stub, red LIVE DATA when at least one job ran live and zero
  // stubs. The S10 walkthrough that triggered this rewrite ran live but
  // showed no banner at all — the asymmetry was the bug.
  const stubJobs = bundle.jobs.filter((j) => j.aiMode === 'stub')
  const liveJobs = bundle.jobs.filter((j) => j.aiMode === 'live')
  const hasStub = stubJobs.length > 0
  const hasLive = liveJobs.length > 0
  const mixed = hasStub && hasLive
  const failed = bundle.jobs.find((j) => j.status === 'FAILED')
  const liveModelCounts = new Map<string, number>()
  for (const j of liveJobs) {
    if (!j.aiModel) continue
    liveModelCounts.set(j.aiModel, (liveModelCounts.get(j.aiModel) ?? 0) + 1)
  }
  const liveModelLabel = Array.from(liveModelCounts.entries())
    .map(([m, n]) => `${m}×${n}`)
    .join(' · ')

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>{t('pipeline.title')}</Text>
          <Badge color={bundle.document.status === 'READY' ? 'green' : 'blue'}>
            {t(`document.status.${bundle.document.status}`)}
          </Badge>
        </Group>
        {hasStub ? (
          <Alert
            color="yellow"
            variant="filled"
            title={
              <Group gap="xs">
                <Badge color="yellow" variant="filled" size="lg">
                  STUB DATA
                </Badge>
                <Text c="white" size="sm">
                  {mixed ? `${stubJobs.length} stub jobs · ${liveJobs.length} live` : 'fixtures only — $0 spend'}
                </Text>
              </Group>
            }
          >
            {stubJobs.length} pipeline job{stubJobs.length === 1 ? '' : 's'} ran with
            <code style={{ marginInline: 4 }}>AI_MODE=stub</code>. Outputs are deterministic
            fixtures; door/window/room rows are NOT extracted from your PDF. Restart the API
            with <code style={{ marginInline: 4 }}>AI_MODE=live</code> for a real run.
          </Alert>
        ) : hasLive ? (
          <Alert
            color="red"
            variant="light"
            title={
              <Group gap="xs">
                <Badge color="red" variant="filled" size="lg">
                  LIVE DATA
                </Badge>
                <Text size="sm" c="dimmed">
                  {liveModelLabel || 'real Anthropic calls'}
                </Text>
              </Group>
            }
          >
            Every row below was extracted by the real model — counts/dims/areas reflect what
            the vision pass actually returned. This run was billed.
          </Alert>
        ) : null}
        {failed ? (
          <Alert
            color="red"
            variant="light"
            title={
              <Group justify="space-between" wrap="nowrap">
                <Text fw={600}>{failed.type} failed</Text>
                <Button
                  size="xs"
                  color="red"
                  variant="filled"
                  onClick={() => retryMutation.mutate(failed.id)}
                  loading={retryMutation.isPending}
                >
                  Retry stage
                </Button>
              </Group>
            }
          >
            {failed.error ?? 'No error message recorded.'} Re-queueing just this stage is
            idempotent — already-classified work won't double-bill.
          </Alert>
        ) : null}
        <Progress value={(done / total) * 100} />
        <Stack gap={4}>
          {STAGES.map((stage) => {
            const j = latest[stage]
            return (
              <Group key={stage} justify="space-between">
                <Text size="sm">{t(`pipeline.${stage}`)}</Text>
                <Group gap="xs">
                  {j?.aiMode === 'stub' ? (
                    <Badge color="yellow" variant="outline" size="xs">
                      stub
                    </Badge>
                  ) : null}
                  <Badge color={statusColor(j?.status ?? 'QUEUED')} variant="light">
                    {t(`pipeline.status.${j?.status ?? 'QUEUED'}`)}
                  </Badge>
                </Group>
              </Group>
            )
          })}
        </Stack>
      </Stack>
    </Card>
  )
}
