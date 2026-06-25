import { useState } from 'react'
import { Alert, Badge, Button, Card, Group, Stack, Table, Text } from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { fetchProjectDocuments, retryJob } from '../api/takeoff.api'

/**
 * Sprint-10 PA-4 — list every Document in the project with its job
 * roll-up: which ones are FAILED, RUNNING, or DONE. The owner now sees
 * dead runs at the list level instead of having to re-open each
 * document. Retry fires on the first failed stage of the chosen run.
 */
export function DocumentsListCard({
  projectId,
  onSelect,
}: {
  projectId: string
  onSelect: (documentId: string) => void
}) {
  const qc = useQueryClient()
  const [skippedExpanded, setSkippedExpanded] = useState(false)
  const docs = useQuery({
    queryKey: ['documents', 'list', projectId],
    queryFn: () => fetchProjectDocuments(projectId),
    refetchInterval: 8_000,
  })
  const retryMutation = useMutation({
    mutationFn: (jobId: string) => retryJob(jobId),
    onSuccess: (j) => {
      notifications.show({
        color: 'green',
        title: 'Stage re-enqueued',
        message: `${j.type} is queued — the worker will pick it up shortly.`,
      })
      void qc.invalidateQueries({ queryKey: ['documents', 'list', projectId] })
    },
    onError: (err) => {
      notifications.show({
        color: 'red',
        title: 'Retry failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    },
  })

  if (docs.isLoading) {
    return (
      <Card withBorder>
        <Text c="dimmed">Loading documents…</Text>
      </Card>
    )
  }
  if (docs.isError) {
    return (
      <Alert color="red" variant="light" title="Failed to load documents">
        {docs.error instanceof Error ? docs.error.message : 'Unknown error'}
      </Alert>
    )
  }
  const rows = docs.data ?? []
  if (rows.length === 0) {
    return null
  }
  const anyFailed = rows.some((r) => r.jobs.failed > 0)

  // SPA-SKIPPED (2026-06-25) — real drawing sets are 20–50 DXFs;
  // most non-floor-plan files auto-skip. Showing 50 grey SKIPPED
  // rows above the actually-active docs makes the table unusable.
  // Render active docs in the main table; collapse SKIPPED into one
  // "N sheets skipped — click to expand" row at the bottom.
  const activeRows = rows.filter((r) => r.status !== 'SKIPPED')
  const skippedRows = rows.filter((r) => r.status === 'SKIPPED')

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Documents</Text>
          {anyFailed ? (
            <Badge color="red" variant="filled">
              FAILED runs present
            </Badge>
          ) : null}
        </Group>
        <Table striped withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Filename</Table.Th>
              <Table.Th>Pages</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Jobs (DONE/RUNNING/QUEUED/FAILED)</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {activeRows.map((d) => (
              <Table.Tr key={d.id}>
                <Table.Td>
                  <Button variant="subtle" size="xs" onClick={() => onSelect(d.id)}>
                    {d.filename}
                  </Button>
                </Table.Td>
                <Table.Td>{d.pageCount ?? '—'}</Table.Td>
                <Table.Td>
                  <Badge
                    color={
                      d.status === 'READY'
                        ? 'green'
                        : d.status === 'FAILED'
                        ? 'red'
                        : d.status === 'PROCESSING'
                        ? 'blue'
                        : d.status === 'SKIPPED'
                        ? 'gray'
                        : 'gray'
                    }
                    variant={d.jobs.failed > 0 ? 'filled' : 'light'}
                    title={
                      d.status === 'SKIPPED'
                        ? 'Excluded from extraction — no room labels detected, or layer mapping was cancelled'
                        : undefined
                    }
                  >
                    {d.jobs.failed > 0 ? 'FAILED' : d.status}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    <Badge color="green" variant="light">
                      {d.jobs.total - d.jobs.failed - d.jobs.running - d.jobs.queued} done
                    </Badge>
                    {d.jobs.running ? (
                      <Badge color="blue" variant="light">
                        {d.jobs.running} running
                      </Badge>
                    ) : null}
                    {d.jobs.queued ? (
                      <Badge color="gray" variant="light">
                        {d.jobs.queued} queued
                      </Badge>
                    ) : null}
                    {d.jobs.failed ? (
                      <Badge color="red" variant="filled">
                        {d.jobs.failed} failed
                      </Badge>
                    ) : null}
                  </Group>
                </Table.Td>
                <Table.Td>
                  {d.firstFailedJob ? (
                    <Button
                      size="xs"
                      color="red"
                      variant="filled"
                      onClick={() => retryMutation.mutate(d.firstFailedJob!.id)}
                      loading={retryMutation.isPending}
                    >
                      Retry {d.firstFailedJob.type}
                    </Button>
                  ) : null}
                </Table.Td>
              </Table.Tr>
            ))}

            {/* SPA-SKIPPED — collapse SKIPPED docs (elevations,
                sections, RCPs, bathroom details, finish keys, etc.
                auto-skipped by DXF introspection because they have
                no room labels) into one row; click to expand. */}
            {skippedRows.length > 0 && !skippedExpanded ? (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      <strong>{skippedRows.length}</strong> sheets skipped (elevations, sections, details — no room labels detected)
                    </Text>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => setSkippedExpanded(true)}
                    >
                      Expand all
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ) : null}
            {skippedRows.length > 0 && skippedExpanded
              ? skippedRows.map((d, idx) => (
                  <Table.Tr key={d.id}>
                    <Table.Td>
                      {idx === 0 ? (
                        <Group gap="xs">
                          <Button
                            variant="subtle"
                            size="xs"
                            onClick={() => onSelect(d.id)}
                            style={{ opacity: 0.7 }}
                          >
                            {d.filename}
                          </Button>
                          <Button
                            size="xs"
                            variant="subtle"
                            color="gray"
                            onClick={() => setSkippedExpanded(false)}
                          >
                            Collapse {skippedRows.length} skipped
                          </Button>
                        </Group>
                      ) : (
                        <Button
                          variant="subtle"
                          size="xs"
                          onClick={() => onSelect(d.id)}
                          style={{ opacity: 0.7 }}
                        >
                          {d.filename}
                        </Button>
                      )}
                    </Table.Td>
                    <Table.Td>{d.pageCount ?? '—'}</Table.Td>
                    <Table.Td>
                      <Badge color="gray" variant="light">SKIPPED</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">—</Text>
                    </Table.Td>
                    <Table.Td />
                  </Table.Tr>
                ))
              : null}
          </Table.Tbody>
        </Table>
      </Stack>
    </Card>
  )
}
