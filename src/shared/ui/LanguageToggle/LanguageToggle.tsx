import { ActionIcon, Menu } from '@mantine/core'
import { Check, Translate } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, type AppLanguage } from '../../config/constants'

const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  en: 'English',
  ar: 'العربية',
}

/**
 * Language switcher. Changing the language updates i18next, which drives the
 * `dir`/`lang` attributes (see I18nProvider) — Mantine's DirectionProvider then
 * flips the whole UI to RTL automatically.
 */
export function LanguageToggle() {
  const { t, i18n } = useTranslation()
  const current = i18n.resolvedLanguage

  return (
    <Menu position="bottom-end" width={180} withinPortal>
      <Menu.Target>
        <ActionIcon size="lg" aria-label={t('actions.changeLanguage')}>
          <Translate size={18} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {SUPPORTED_LANGUAGES.map((lng) => (
          <Menu.Item
            key={lng}
            onClick={() => void i18n.changeLanguage(lng)}
            rightSection={current === lng ? <Check size={14} /> : null}
          >
            {LANGUAGE_LABELS[lng]}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
