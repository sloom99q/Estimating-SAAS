import { Badge, Card, Group, Progress, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { DocumentBundle, JobDto } from '../api/takeoff.api'

const STAGES = ['INGEST', 'CLASSIFY', 'EXTRACT_SCHEDULES', 'EXTRACT_ROOMS'] as const

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

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>{t('pipeline.title')}</Text>
          <Badge color={bundle.document.status === 'READY' ? 'green' : 'blue'}>
            {t(`document.status.${bundle.document.status}`)}
          </Badge>
        </Group>
        <Progress value={(done / total) * 100} />
        <Stack gap={4}>
          {STAGES.map((stage) => {
            const j = latest[stage]
            return (
              <Group key={stage} justify="space-between">
                <Text size="sm">{t(`pipeline.${stage}`)}</Text>
                <Badge color={statusColor(j?.status ?? 'QUEUED')} variant="light">
                  {t(`pipeline.status.${j?.status ?? 'QUEUED'}`)}
                </Badge>
              </Group>
            )
          })}
        </Stack>
      </Stack>
    </Card>
  )
}
