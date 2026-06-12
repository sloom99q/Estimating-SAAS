import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Card,
  Center,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { GenerateBoqCard } from '../components/GenerateBoqCard'
import { TakeoffTable } from '../components/TakeoffTable'
import { PipelineStatus } from '../components/PipelineStatus'
import { UploadCard } from '../components/UploadCard'
import { useDocumentBundle, useTakeoffBundle } from '../api/useTakeoff'

/**
 * Sprint-2 Review UI entry point. Three sections stacked vertically:
 *   1. Upload card — multipart POST to /api/projects/:id/documents.
 *   2. Pipeline status card — polls /api/documents/:id while INGEST..EXTRACT_*
 *      are running; goes away once the pipeline is terminal.
 *   3. Review table — polled via TakeoffBundle; grouped by category; "needs
 *      review" filter scopes to unresolved flags OR confidence < 85.
 */
export function TakeoffPage() {
  const { t } = useTranslation('takeoff')
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'needsReview'>('all')

  const docBundle = useDocumentBundle(activeDocumentId)
  const documentInFlight =
    docBundle.data && docBundle.data.document.status !== 'READY' && docBundle.data.document.status !== 'FAILED'
  const takeoff = useTakeoffBundle(projectId, documentInFlight ? { pollMs: 3_000 } : {})

  // When the pipeline lands READY, drop the active-document state so the
  // pipeline card stops showing once the review table is fresh.
  useEffect(() => {
    if (docBundle.data?.document.status === 'READY' || docBundle.data?.document.status === 'FAILED') {
      // Refresh the takeoff table one more time, then keep the pipeline card
      // visible — useful proof for the user that processing finished.
      void takeoff.refetch()
    }
  }, [docBundle.data?.document.status, takeoff])

  const projectFlags = takeoff.data?.projectFlags ?? []
  const reviewSummary = useMemo(() => {
    if (!takeoff.data) return null
    const totalItems = takeoff.data.items.length
    const needsReview = takeoff.data.items.filter((i) => {
      if (i.confidence < 85) return true
      return (takeoff.data!.flagsByItem[i.id] ?? []).some((f) => !f.resolved)
    }).length
    return { totalItems, needsReview }
  }, [takeoff.data])

  if (!projectId) {
    return (
      <Center mih={300}>
        <Text c="red">Missing :projectId route param.</Text>
      </Center>
    )
  }

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Title order={2}>{t('page.title')}</Title>
        <Text c="dimmed">{t('page.subtitle')}</Text>
      </Stack>

      <UploadCard projectId={projectId} onUploaded={setActiveDocumentId} />

      {docBundle.data ? <PipelineStatus bundle={docBundle.data} /> : null}

      <GenerateBoqCard
        projectId={projectId}
        ready={docBundle.data?.document.status === 'READY'}
      />

      {projectFlags.length > 0 ? (
        <Card withBorder>
          <Stack gap="xs">
            <Text fw={600}>{t('projectFlags.title')}</Text>
            {projectFlags.map((flag) => (
              <Alert
                key={flag.id}
                color={flag.severity === 'ERROR' ? 'red' : flag.severity === 'WARN' ? 'yellow' : 'blue'}
                variant="light"
                title={flag.rule}
              >
                {flag.message}
              </Alert>
            ))}
          </Stack>
        </Card>
      ) : null}

      <Group justify="space-between">
        <Group>
          <SegmentedControl
            value={filter}
            onChange={(v) => setFilter(v as 'all' | 'needsReview')}
            data={[
              { value: 'all', label: t('filter.all') },
              { value: 'needsReview', label: t('filter.needsReview') },
            ]}
          />
          {reviewSummary ? (
            <Badge variant="light">
              {reviewSummary.needsReview}/{reviewSummary.totalItems}
            </Badge>
          ) : null}
        </Group>
      </Group>

      {takeoff.isLoading ? (
        <Center mih={120}>
          <Loader />
        </Center>
      ) : takeoff.error ? (
        <Alert color="red" variant="light">
          {t('errors.loadFailed')}
        </Alert>
      ) : takeoff.data ? (
        <TakeoffTable
          projectId={projectId}
          bundle={takeoff.data}
          needsReviewOnly={filter === 'needsReview'}
        />
      ) : null}
    </Stack>
  )
}
