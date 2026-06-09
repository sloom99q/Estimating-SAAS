import { ActionIcon, Avatar, Burger, Group, Menu, Text, Tooltip, UnstyledButton } from '@mantine/core'
import { Bug, SidebarSimple, SignOut } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { paths } from '@/app/router/paths'
import { sessionActions, useCurrentUser } from '@/shared/store/sessionStore'
import { useCostTraceEnabled, useUiStore } from '@/shared/store/uiStore'
import { LanguageToggle, Logo, ThemeToggle } from '@/shared/ui'

interface DashboardHeaderProps {
  mobileOpened: boolean
  onToggleMobile: () => void
}

export function DashboardHeader({ mobileOpened, onToggleMobile }: DashboardHeaderProps) {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const navigate = useNavigate()
  const toggleNav = useUiStore((s) => s.toggleNav)
  const toggleCostTrace = useUiStore((s) => s.toggleCostTrace)
  const costTraceEnabled = useCostTraceEnabled()
  // Dev affordance only — the rate-provenance tags it surfaces inside the
  // workspace cost breakdown are noise for a real user.
  const isDev = import.meta.env.DEV

  const handleLogout = () => {
    sessionActions.clearSession()
    void navigate(paths.login, { replace: true })
  }

  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group gap="sm" wrap="nowrap">
        <Burger
          opened={mobileOpened}
          onClick={onToggleMobile}
          hiddenFrom="sm"
          size="sm"
          aria-label={t('actions.toggleNav')}
        />
        <ActionIcon
          visibleFrom="sm"
          onClick={toggleNav}
          aria-label={t('actions.toggleNav')}
          size="lg"
        >
          <SidebarSimple size={18} />
        </ActionIcon>
        <Logo />
      </Group>

      <Group gap="xs" wrap="nowrap">
        {isDev ? (
          <Tooltip label="Toggle cost-trace (dev)" position="bottom" withArrow>
            <ActionIcon
              size="lg"
              color={costTraceEnabled ? 'info' : 'gray'}
              variant={costTraceEnabled ? 'light' : 'subtle'}
              onClick={toggleCostTrace}
              aria-label="Toggle cost trace"
            >
              <Bug size={18} />
            </ActionIcon>
          </Tooltip>
        ) : null}
        <ThemeToggle />
        <LanguageToggle />
        {user ? (
          <Menu position="bottom-end" width={210} withinPortal>
            <Menu.Target>
              <UnstyledButton aria-label={user.fullName}>
                <Group gap="xs" wrap="nowrap">
                  <Avatar src={user.avatarUrl} name={user.fullName} color="ink" radius="xl" size={32} />
                  <Text fz="sm" fw={500} visibleFrom="sm" maw={140} truncate>
                    {user.fullName}
                  </Text>
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{user.email}</Menu.Label>
              <Menu.Item color="danger" leftSection={<SignOut size={16} />} onClick={handleLogout}>
                {t('actions.logout')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        ) : null}
      </Group>
    </Group>
  )
}
