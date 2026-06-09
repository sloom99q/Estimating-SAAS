import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { Check } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import type { ProjectProgress, ProjectStep } from '../domain/progress'

interface ProjectFlowStepperProps {
  progress: ProjectProgress
  /** Called when the user clicks a navigable step (current or done). */
  onStepClick?: (step: ProjectStep) => void
}

/**
 * Horizontal stepper that sits above the workspace. Visualises where the user
 * is in the four-step journey (`project → spaces → materials → quotation`)
 * and lets them jump to a step. Done steps render an ink fill + check mark;
 * the current step is a high-contrast ink outline; future steps are dim.
 *
 * Stripe / Linear-style restraint: hairline borders, no shadows, no
 * gradients. The thin connector line between steps fills only the portion
 * already completed, so the progress reads in two passes — first the
 * connector line, then the marker labels.
 */
export function ProjectFlowStepper({ progress, onStepClick }: ProjectFlowStepperProps) {
  const { t } = useTranslation(['projects'])

  return (
    <Box
      p="md"
      style={{
        background: 'var(--app-surface)',
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--mantine-radius-md)',
      }}
    >
      <Group gap={0} align="flex-start" wrap="wrap">
        {progress.steps.map((entry, index) => {
          const isLast = index === progress.steps.length - 1
          return (
            <Group key={entry.step} gap={0} align="flex-start" wrap="nowrap" style={{ flex: 1 }}>
              <StepCell
                step={entry.step}
                status={entry.status}
                index={index + 1}
                onClick={onStepClick ? () => onStepClick(entry.step) : undefined}
                label={t(`projects:flow.${entry.step}`)}
                hint={t(`projects:flow.hint.${entry.step}`)}
              />
              {!isLast ? <Connector active={entry.status === 'done'} /> : null}
            </Group>
          )
        })}
      </Group>
    </Box>
  )
}

interface StepCellProps {
  step: ProjectStep
  status: 'done' | 'current' | 'upcoming'
  index: number
  label: string
  hint: string
  onClick?: (() => void) | undefined
}

function StepCell({ status, index, label, hint, onClick }: StepCellProps) {
  const navigable = Boolean(onClick) && status !== 'upcoming'
  const content = (
    <Group gap="md" wrap="nowrap" align="flex-start">
      <Marker status={status} index={index} />
      <Stack gap={0}>
        {status === 'upcoming' ? (
          <Text
            fz="xs"
            fw={600}
            c="dimmed"
            tt="uppercase"
            style={{ letterSpacing: '0.08em' }}
          >
            {label}
          </Text>
        ) : (
          <Text fz="xs" fw={600} tt="uppercase" style={{ letterSpacing: '0.08em' }}>
            {label}
          </Text>
        )}
        <Text fz="xs" c="dimmed" lineClamp={1}>
          {hint}
        </Text>
      </Stack>
    </Group>
  )

  if (!navigable) {
    return (
      <Box style={{ flex: 1, padding: '4px 0' }}>
        {content}
      </Box>
    )
  }

  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        flex: 1,
        padding: '4px 6px',
        borderRadius: 'var(--mantine-radius-sm)',
      }}
      className="project-flow-step"
    >
      {content}
    </UnstyledButton>
  )
}

function Marker({
  status,
  index,
}: {
  status: 'done' | 'current' | 'upcoming'
  index: number
}) {
  const done = status === 'done'
  const current = status === 'current'
  return (
    <Box
      aria-hidden
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        background: done
          ? 'var(--mantine-color-text)'
          : current
            ? 'var(--app-surface)'
            : 'var(--app-surface-muted)',
        border: '1px solid',
        borderColor: done
          ? 'var(--mantine-color-text)'
          : current
            ? 'var(--mantine-color-text)'
            : 'var(--app-border)',
        color: done ? 'var(--mantine-color-body)' : 'var(--mantine-color-text)',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: 'var(--app-font-mono)',
      }}
    >
      {done ? <Check size={14} weight="bold" /> : index.toString().padStart(2, '0')}
    </Box>
  )
}

function Connector({ active }: { active: boolean }) {
  return (
    <Box
      aria-hidden
      style={{
        height: 1,
        background: active ? 'var(--mantine-color-text)' : 'var(--app-border)',
        flex: 1,
        marginTop: 14,
        marginInline: 8,
        opacity: active ? 0.8 : 1,
      }}
    />
  )
}
