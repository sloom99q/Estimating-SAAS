import { ActionIcon, useComputedColorScheme, useMantineColorScheme } from '@mantine/core'
import { Moon, Sun } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

/**
 * Light/dark toggle. Mantine's color-scheme manager is the single owner of this
 * preference (persisted to localStorage); we just flip it here.
 */
export function ThemeToggle() {
  const { t } = useTranslation()
  const { setColorScheme } = useMantineColorScheme()
  const computed = useComputedColorScheme('light', { getInitialValueInEffect: true })
  const isDark = computed === 'dark'

  return (
    <ActionIcon
      size="lg"
      onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
      aria-label={t('actions.toggleTheme')}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </ActionIcon>
  )
}
