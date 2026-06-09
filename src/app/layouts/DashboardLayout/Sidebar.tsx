import { Box, NavLink, ScrollArea, Stack, Tooltip } from '@mantine/core'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { NavLink as RouterNavLink, useLocation } from 'react-router'
import { useCan } from '@/shared/store/sessionStore'
import { navItems, type NavItem } from './navigation'

interface SidebarProps {
  collapsed: boolean
  /** Called on item click — used to auto-close the mobile drawer. */
  onNavigate: () => void
}

export function Sidebar({ collapsed, onNavigate }: SidebarProps) {
  const { t } = useTranslation()
  return (
    <Box component="nav" p="sm" h="100%">
      <ScrollArea h="100%" type="never">
        <Stack gap={4}>
          {navItems.map((item) => (
            <SidebarItem
              key={item.to}
              item={item}
              collapsed={collapsed}
              onNavigate={onNavigate}
              t={t}
            />
          ))}
        </Stack>
      </ScrollArea>
    </Box>
  )
}

interface SidebarItemProps {
  item: NavItem
  collapsed: boolean
  onNavigate: () => void
  t: TFunction
}

function SidebarItem({ item, collapsed, onNavigate, t }: SidebarItemProps) {
  const { pathname } = useLocation()
  // Hooks must run unconditionally; the result is ignored when no permission is set.
  const allowed = useCan(item.permission ?? 'users:read')
  const visible = item.permission ? allowed : true
  if (!visible) return null

  const Icon = item.icon
  const active = pathname === item.to || pathname.startsWith(`${item.to}/`)
  const label = t(item.labelKey)

  const link = (
    <NavLink
      renderRoot={(rootProps) => <RouterNavLink to={item.to} onClick={onNavigate} {...rootProps} />}
      active={active}
      label={collapsed ? undefined : label}
      leftSection={<Icon size={20} />}
      variant="light"
    />
  )

  return collapsed ? (
    <Tooltip label={label} position="right" withArrow>
      {link}
    </Tooltip>
  ) : (
    link
  )
}
