import { Alert, Badge, Group, Text, Tooltip } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { fetchEnvStatus } from '../api/systemStatus.api'

/**
 * P-package P-TOP — pre-upload run-mode banner. Reads
 * `/api/system/env-status` so the SPA reflects the BOOTED runtime,
 * never a build-time guess. When the booted mode differs from the
 * disk's `AI_MODE`, we shout RESTART REQUIRED.
 *
 *   - LIVE  → red badge, "Real Anthropic calls will be billed."
 *   - STUB  → yellow badge, "Stub fixtures only — no Anthropic calls."
 *   - boot ≠ disk → orange alert under the badge.
 */
export function EnvBanner() {
  const status = useQuery({
    queryKey: ['system', 'env-status'],
    queryFn: fetchEnvStatus,
    refetchInterval: 15_000,
  })

  if (status.isLoading || !status.data) {
    return null
  }

  const { bootedAiMode, diskAiMode, restartRequired, anthropicModel, anthropicModels, anthropicModelSameAcrossStages, keyPresent } =
    status.data
  const isLive = bootedAiMode === 'live'
  const modelDisplay = anthropicModelSameAcrossStages
    ? anthropicModel
    : `classify=${anthropicModels.classify}, vision=${anthropicModels.vision}, default=${anthropicModels.default}`

  return (
    <Alert
      color={isLive ? 'red' : 'yellow'}
      variant="light"
      title={
        <Group gap="xs">
          <Badge color={isLive ? 'red' : 'yellow'} variant="filled" size="lg">
            {isLive ? 'LIVE — real Anthropic calls' : 'STUB DATA — fixtures only'}
          </Badge>
          <Tooltip label={isLive ? `model: ${modelDisplay}` : 'stub mode is $0; outputs are deterministic'}>
            <Text size="xs" c="dimmed">
              {isLive ? `model ${modelDisplay}` : 'no tokens'}
            </Text>
          </Tooltip>
          {!keyPresent && isLive ? (
            <Badge color="red" variant="outline">
              key missing
            </Badge>
          ) : null}
        </Group>
      }
    >
      {isLive
        ? 'Any upload from here will be billed at sonnet / opus rates depending on the per-stage model.'
        : 'Any upload from here returns deterministic stub fixtures. Outputs are flagged in the data and downstream UI.'}
      {restartRequired ? (
        <Alert mt="sm" color="orange" variant="filled" title="Restart required">
          <code>.env</code> on disk says <strong>AI_MODE={diskAiMode}</strong> but the worker booted with{' '}
          <strong>AI_MODE={bootedAiMode}</strong>. Stop and restart the API to pick up the change.
        </Alert>
      ) : null}
    </Alert>
  )
}
