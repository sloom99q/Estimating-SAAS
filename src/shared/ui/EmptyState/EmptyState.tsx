import { Stack, Text, ThemeIcon, Title } from '@mantine/core'
import type { IconProps } from '@phosphor-icons/react'
import type { ComponentType, ReactNode } from 'react'

interface EmptyStateProps {
  icon: ComponentType<IconProps>
  title: string
  description?: string
  /** Optional call-to-action (e.g. an invite button). */
  action?: ReactNode
}

/** Composed empty/zero state — used for empty lists and error fallbacks. */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <Stack align="center" gap="sm" py={56} px="md">
      <ThemeIcon variant="light" color="gray" size={56} radius="md">
        <Icon size={26} />
      </ThemeIcon>
      <Title order={3} fz="h4" ta="center">
        {title}
      </Title>
      {description ? (
        <Text c="dimmed" fz="sm" ta="center" maw={380}>
          {description}
        </Text>
      ) : null}
      {action}
    </Stack>
  )
}
