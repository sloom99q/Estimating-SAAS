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
import { DocumentsListCard } from '../components/DocumentsListCard'
import { EnvBanner } from '../components/EnvBanner'
import { EstimateKitchenCard } from '../components/EstimateKitchenCard'
import { EstimateWardrobesCard } from '../components/EstimateWardrobesCard'
import { GenerateBoqCard } from '../components/GenerateBoqCard'
import { TakeoffTable } from '../components/TakeoffTable'
import { PipelineStatus } from '../components/PipelineStatus'
import { UploadCard } from '../components/UploadCard'
import { fetchProjectDocuments } from '../api/takeoff.api'
import { useDocumentBundle, useTakeoffBundle } from '../api/useTakeoff'
import { useQuery } from '@tanstack/react-query'

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

  // PE-1 bootstrap — when the page loads with no upload context, fetch the
  // project's documents and auto-select the most recent READY one. Without
  // this, GenerateBoqCard never renders, owners can't reach existing BOQs,
  // and the only way to get the button was to re-upload the PDF (paying
  // tokens for nothing).
  const documents = useQuery({
    queryKey: ['documents', 'list', projectId],
    queryFn: () => fetchProjectDocuments(projectId!),
    enabled: !!projectId,
  })
  useEffect(() => {
    if (activeDocumentId) return
    const docs = documents.data
    if (!docs || docs.length === 0) return
    const ready = docs.find((d) => d.status === 'READY')
    const fallback = ready ?? docs[0]
    if (fallback) setActiveDocumentId(fallback.id)
  }, [activeDocumentId, documents.data])

  const docBundle = useDocumentBundle(activeDocumentId)
  const documentInFlight =
    docBundle.data && docBundle.data.document.status !== 'READY' && docBundle.data.document.status !== 'FAILED'
  const takeoff = useTakeoffBundle(projectId, documentInFlight ? { pollMs: 3_000 } : {})

  // When the pipeline lands READY, refresh the takeoff table — useful proof
  // for the user that processing finished. Kept here for the upload flow;
  // the takeoff table also polls on its own when a doc is in flight.
  useEffect(() => {
    if (docBundle.data?.document.status === 'READY' || docBundle.data?.document.status === 'FAILED') {
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

      <EnvBanner />

      <UploadCard projectId={projectId} onUploaded={setActiveDocumentId} />

      <DocumentsListCard projectId={projectId} onSelect={setActiveDocumentId} />

      {documentInFlight ? (
        <Alert color="blue" variant="light" title={t('serverContinues.title')}>
          {t('serverContinues.body')}
        </Alert>
      ) : null}

      {docBundle.data ? <PipelineStatus bundle={docBundle.data} /> : null}

      <GenerateBoqCard
        projectId={projectId}
        // PE-1 — render the card whenever the project has either a READY
        // document OR an existing takeoff (a previous run's data carries
        // through even if the doc selection is stale). The download path
        // for any existing BOQ is the right surface here.
        ready={
          docBundle.data?.document.status === 'READY' ||
          (takeoff.data?.items.length ?? 0) > 0
        }
        // MULTI-DOC #1 (2026-06-21) — block Re-run BOQ while any doc is
        // still mid-pipeline. Partial BOQs from half-ingested drawing
        // sets are the problem this is fixing.
        pendingDocsCount={
          (documents.data ?? []).filter(
            (d) => d.status !== 'READY' && d.status !== 'FAILED',
          ).length
        }
        totalDocsCount={(documents.data ?? []).length}
      />

      <EstimateKitchenCard
        projectId={projectId}
        ready={
          docBundle.data?.document.status === 'READY' ||
          (takeoff.data?.items.length ?? 0) > 0
        }
      />

      <EstimateWardrobesCard
        projectId={projectId}
        ready={
          docBundle.data?.document.status === 'READY' ||
          (takeoff.data?.items.length ?? 0) > 0
        }
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
