import { useMemo, useState } from 'react'
import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Progress,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@mantine/core'
import { ArrowsClockwise, CheckCircle, Warning, XCircle } from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchBoqAudit, type FlaggedLine } from '../api/takeoff.api'

/**
 * REVIEW-2 — the review queue card.
 *
 * Lights up next to the BOQ download buttons once a BOQ exists. Calls
 * GET /api/boqs/:id/audit, which runs the deterministic auditor
 * pipeline (Integrity + Confidence today; Engineering + Procurement
 * plug in later) and persists verificationStatus per line.
 *
 * The headline is the whole point: "X verified, Y need review". The
 * estimator only touches what's flagged.
 */
export function BoqReviewQueueCard({ boqId }: { boqId: string }) {
  const qc = useQueryClient()
  const audit = useQuery({
    queryKey: ['boqs', boqId, 'audit'],
    queryFn: () => fetchBoqAudit(boqId),
    refetchOnWindowFocus: false,
  })

  if (audit.isLoading) {
    return (
      <Card withBorder>
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Running deterministic audit…
          </Text>
        </Group>
      </Card>
    )
  }
  if (audit.isError || !audit.data) {
    return (
      <Card withBorder>
        <Stack gap="xs">
          <Text size="sm" c="red">
            Audit failed: {audit.error instanceof Error ? audit.error.message : 'unknown error'}
          </Text>
          <Button size="xs" variant="light" onClick={() => audit.refetch()}>
            Retry
          </Button>
        </Stack>
      </Card>
    )
  }

  const { summary, flagged } = audit.data
  const verifiedPct = summary.total > 0 ? (summary.verified / summary.total) * 100 : 0
  const reviewPct = summary.total > 0 ? (summary.review / summary.total) * 100 : 0
  const failedPct = summary.total > 0 ? (summary.failed / summary.total) * 100 : 0
  const needAttention = summary.review + summary.failed

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-end" wrap="nowrap">
          <Stack gap={4}>
            <Group gap="xs">
              <Text fw={600}>Review queue</Text>
              <Badge size="sm" color="gray" variant="light">
                deterministic
              </Badge>
            </Group>
            <Text size="xl" fw={700} lh={1}>
              <Text span c="teal" inherit>
                {summary.verified} verified
              </Text>
              {needAttention > 0 ? (
                <>
                  {' · '}
                  <Text span c={summary.failed > 0 ? 'red' : 'orange'} inherit>
                    {needAttention} need review
                  </Text>
                </>
              ) : (
                <>
                  {' · '}
                  <Text span c="dimmed" inherit>
                    clean
                  </Text>
                </>
              )}
            </Text>
            <Text size="xs" c="dimmed">
              {summary.total} BOQ lines · BOQ v{audit.data.boq.version}
            </Text>
          </Stack>
          <Tooltip label="Re-run audit">
            <ActionIcon
              variant="subtle"
              onClick={() => {
                void qc.invalidateQueries({ queryKey: ['boqs', boqId, 'audit'] })
              }}
              aria-label="Re-run audit"
            >
              <ArrowsClockwise size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>

        <Progress.Root size="md">
          <Progress.Section value={verifiedPct} color="teal" />
          <Progress.Section value={reviewPct} color="orange" />
          <Progress.Section value={failedPct} color="red" />
        </Progress.Root>

        {summary.failed > 0 ? (
          <Alert color="red" variant="light" icon={<XCircle size={18} />}>
            {summary.failed} line{summary.failed === 1 ? '' : 's'} failed the structural integrity
            check. These are missing provenance or have a malformed derivation — they cannot ship
            without being fixed.
          </Alert>
        ) : null}

        {flagged.length === 0 ? (
          <Alert color="teal" variant="light" icon={<CheckCircle size={18} />}>
            Every BOQ line passed the deterministic auditor. Nothing in the review queue.
          </Alert>
        ) : (
          <FlaggedAccordion lines={flagged} />
        )}

        <SummaryFooter summary={summary} />
      </Stack>
    </Card>
  )
}

function FlaggedAccordion({ lines }: { lines: FlaggedLine[] }) {
  // Group flagged lines by section so the estimator can sweep one
  // section at a time — section context tells you what kind of error
  // to expect (finishes vs joinery vs P/S).
  const bySection = useMemo(() => {
    const map = new Map<string, FlaggedLine[]>()
    for (const l of lines) {
      const arr = map.get(l.sectionCode) ?? []
      arr.push(l)
      map.set(l.sectionCode, arr)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [lines])

  const [openSections, setOpenSections] = useState<string[]>(() =>
    bySection.length > 0 ? [bySection[0]![0]] : [],
  )

  return (
    <Accordion multiple value={openSections} onChange={setOpenSections} variant="separated">
      {bySection.map(([section, secLines]) => {
        const failed = secLines.filter((l) => l.status === 'failed').length
        const review = secLines.filter((l) => l.status === 'review').length
        return (
          <Accordion.Item key={section} value={section}>
            <Accordion.Control>
              <Group gap="xs">
                <Badge variant="filled" color="dark">
                  {section}
                </Badge>
                <Text fw={500}>
                  {secLines.length} line{secLines.length === 1 ? '' : 's'} flagged
                </Text>
                {failed > 0 ? (
                  <Badge color="red" variant="light">
                    {failed} failed
                  </Badge>
                ) : null}
                {review > 0 ? (
                  <Badge color="orange" variant="light">
                    {review} review
                  </Badge>
                ) : null}
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Table verticalSpacing="xs" striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: 70 }}>Ref</Table.Th>
                    <Table.Th>Description</Table.Th>
                    <Table.Th style={{ width: 100 }}>Source</Table.Th>
                    <Table.Th style={{ width: 70, textAlign: 'right' }}>Conf</Table.Th>
                    <Table.Th>Why flagged</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {secLines.map((l) => (
                    <Table.Tr key={l.id}>
                      <Table.Td>
                        <Text size="xs" ff="monospace">
                          {l.itemRef}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{l.description}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={2}>
                          {l.sourceType ? (
                            <Badge size="xs" color={sourceColor(l.sourceType)} variant="light">
                              {l.sourceType}
                            </Badge>
                          ) : null}
                          {l.derivationType ? (
                            <Text size="10px" c="dimmed">
                              {l.derivationType}
                            </Text>
                          ) : null}
                        </Stack>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text size="sm" c={confColor(l.confidence)}>
                          {l.confidence != null ? l.confidence.toFixed(2) : '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={6}>
                          {l.modules
                            .filter((m) => m.reasons.length > 0)
                            .flatMap((m) =>
                              m.reasons.map((r, ix) => {
                                const resolution = m.resolutionSteps?.[ix]
                                const tag = m.tags?.[ix]
                                return (
                                  <Stack key={`${m.module}:${ix}`} gap={2}>
                                    <Group gap={4} wrap="nowrap" align="flex-start">
                                      {m.verdict === 'failed' ? (
                                        <XCircle size={12} color="var(--mantine-color-red-6)" />
                                      ) : (
                                        <Warning size={12} color="var(--mantine-color-orange-6)" />
                                      )}
                                      <Text size="xs">
                                        <Text span c="dimmed" inherit>
                                          [{m.module}]{' '}
                                        </Text>
                                        {r}
                                        {tag ? (
                                          <Text span c="dimmed" inherit ml={4}>
                                            ({tag})
                                          </Text>
                                        ) : null}
                                      </Text>
                                    </Group>
                                    {resolution ? (
                                      <Text
                                        size="11px"
                                        c="dimmed"
                                        pl={20}
                                        style={{ fontStyle: 'italic' }}
                                      >
                                        → {resolution}
                                      </Text>
                                    ) : null}
                                  </Stack>
                                )
                              }),
                            )}
                        </Stack>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Accordion.Panel>
          </Accordion.Item>
        )
      })}
    </Accordion>
  )
}

function SummaryFooter({ summary }: { summary: { bySourceType: Record<string, { verified: number; review: number; failed: number }> } }) {
  const entries = Object.entries(summary.bySourceType)
  if (entries.length === 0) return null
  return (
    <Group gap="md" wrap="wrap">
      {entries.map(([st, c]) => {
        const total = c.verified + c.review + c.failed
        const flagged = c.review + c.failed
        return (
          <Group key={st} gap={4}>
            <Badge size="xs" color={sourceColor(st)} variant="light">
              {st}
            </Badge>
            <Text size="xs" c="dimmed">
              {total - flagged}/{total}
            </Text>
          </Group>
        )
      })}
    </Group>
  )
}

function sourceColor(st: string): string {
  switch (st) {
    case 'MEASURED':
      return 'teal'
    case 'DERIVED':
      return 'blue'
    case 'ESTIMATED':
      return 'orange'
    case 'MANUAL':
      return 'grape'
    case 'IMPORTED':
      return 'cyan'
    default:
      return 'gray'
  }
}

function confColor(c: number | null): string {
  if (c == null) return 'red'
  if (c >= 0.8) return 'teal'
  if (c >= 0.6) return 'dimmed'
  return 'orange'
}
