import { Box, Group, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/shared/utils/format'
import {
  SPACE_TEMPLATES,
  type SpaceTemplate,
} from '../domain/templates'

interface SpaceTemplatePickerProps {
  /** Called when the user clicks a template card. The form pre-fills. */
  onApply: (template: SpaceTemplate) => void
}

/**
 * Visual grid of `SpaceTemplate`s shown above the dimension form in
 * "create a new space" mode. Clicking a card calls back into the form with
 * the template's default dimensions; the user can refine before saving.
 * Editorial, not glossy — same hairline-border / mono-numerals discipline as
 * the rest of the workspace.
 */
export function SpaceTemplatePicker({ onApply }: SpaceTemplatePickerProps) {
  const { t } = useTranslation(['spaces'])

  return (
    <Stack gap="sm">
      <Stack gap={2}>
        <Text
          fz="xs"
          c="dimmed"
          fw={600}
          tt="uppercase"
          style={{ letterSpacing: '0.08em' }}
        >
          {t('spaces:templates.title')}
        </Text>
        <Text fz="xs" c="dimmed">
          {t('spaces:templates.subtitle')}
        </Text>
      </Stack>
      <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="sm">
        {SPACE_TEMPLATES.map((template) => (
          <TemplateCard key={template.id} template={template} onApply={onApply} />
        ))}
      </SimpleGrid>
    </Stack>
  )
}

function TemplateCard({
  template,
  onApply,
}: {
  template: SpaceTemplate
  onApply: (template: SpaceTemplate) => void
}) {
  const { t } = useTranslation(['spaces'])
  return (
    <UnstyledButton
      onClick={() => onApply(template)}
      style={{
        padding: 12,
        borderRadius: 'var(--mantine-radius-md)',
        background: 'var(--app-surface)',
        border: '1px solid var(--app-border)',
        textAlign: 'start',
        transition: 'border-color 120ms ease',
      }}
    >
      <Stack gap={2}>
        <Text fz="sm" fw={600} lineClamp={1}>
          {t(`spaces:templates.${template.nameKey}`)}
        </Text>
        <Text fz="xs" c="dimmed" lineClamp={1}>
          {t(`spaces:templates.${template.subtitleKey}`)}
        </Text>
        <Group gap={4} mt={6} align="baseline">
          <Box
            aria-hidden
            style={{
              width: 20,
              height: 14,
              borderRadius: 3,
              border: '1px solid var(--mantine-color-dimmed)',
              opacity: 0.6,
            }}
          />
          <Text className="app-numeric" fz="xs" c="dimmed">
            {formatNumber(template.dimensions.length)} ×{' '}
            {formatNumber(template.dimensions.width)} ×{' '}
            {formatNumber(template.dimensions.height)} m
          </Text>
        </Group>
      </Stack>
    </UnstyledButton>
  )
}
