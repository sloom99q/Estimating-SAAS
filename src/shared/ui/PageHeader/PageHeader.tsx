import { Group, Stack, Text, Title } from '@mantine/core'
import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  /** Right-aligned action area (buttons, filters). */
  actions?: ReactNode
}

/** Consistent page heading: title + optional description + optional actions. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="flex-start" wrap="wrap" gap="md" mb="xl">
      <Stack gap={4}>
        <Title order={1} fz="h2">
          {title}
        </Title>
        {description ? (
          <Text c="dimmed" fz="sm">
            {description}
          </Text>
        ) : null}
      </Stack>
      {actions ? (
        <Group gap="sm" wrap="nowrap">
          {actions}
        </Group>
      ) : null}
    </Group>
  )
}
