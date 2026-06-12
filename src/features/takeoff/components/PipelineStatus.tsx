import { Alert, Badge, Card, Group, Progress, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { DocumentBundle, JobDto } from '../api/takeoff.api'

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

function latestByType(jobs: JobDto[]): Record<string, JobDto> {
  const map: Record<string, JobDto> = {}
  for (const j of jobs) {
    // jobs come back ordered desc — first hit per type wins.
    if (!map[j.type]) map[j.type] = j
  }
  return map
}

export function PipelineStatus({ bundle }: { bundle: DocumentBundle }) {
  const { t } = useTranslation('takeoff')
  const latest = latestByType(bundle.jobs)
  const done = STAGES.filter((s) => latest[s]?.status === 'DONE').length
  const total = STAGES.length
  // S8-7 stub banner — if any pipeline job ran in stub mode, the operator
  // sees it loud. The S7-5 wasted run came from a stub-mode job nobody
  // noticed; never again.
  const stubJobs = bundle.jobs.filter((j) => j.aiMode === 'stub')
  const hasStub = stubJobs.length > 0
  const failed = bundle.jobs.find((j) => j.status === 'FAILED')

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
          <Alert color="yellow" variant="light" title="Stub mode">
            {stubJobs.length} pipeline job{stubJobs.length === 1 ? '' : 's'} ran with
            <code style={{ marginInline: 4 }}>AI_MODE=stub</code>
            — deterministic stub outputs, no Anthropic calls. Restart the API with
            <code style={{ marginInline: 4 }}>AI_MODE=live</code>
            before a real demo or re-run.
          </Alert>
        ) : null}
        {failed ? (
          <Alert color="red" variant="light" title={`${failed.type} failed`}>
            {failed.error ?? 'No error message recorded.'}
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
