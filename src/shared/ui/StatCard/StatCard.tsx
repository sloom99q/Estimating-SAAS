import { Card, Group, Text, ThemeIcon } from '@mantine/core'
import type { IconProps } from '@phosphor-icons/react'
import type { ComponentType } from 'react'

type StatAccent = 'ink' | 'success' | 'warn' | 'danger' | 'info'

interface StatCardProps {
  label: string
  /** Pre-formatted value. Rendered in tabular monospace via `.app-numeric`. */
  value: string
  icon: ComponentType<IconProps>
  hint?: string
  accent?: StatAccent
}

/** A single KPI tile: uppercase label, large monospace numeric, accent icon. */
export function StatCard({ label, value, icon: Icon, hint, accent = 'ink' }: StatCardProps) {
  return (
    <Card>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Text fz="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.04em' }}>
          {label}
        </Text>
        <ThemeIcon variant="light" color={accent} radius="sm" size="lg">
          <Icon size={18} />
        </ThemeIcon>
      </Group>
      <Text className="app-numeric" fz={28} fw={600} mt="md" lh={1.1}>
        {value}
      </Text>
      {hint ? (
        <Text fz="xs" c="dimmed" mt={6}>
          {hint}
        </Text>
      ) : null}
    </Card>
  )
}
