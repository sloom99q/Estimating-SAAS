import { Buildings, Cube, FolderOpen, House, Users } from '@phosphor-icons/react'
import type { IconProps } from '@phosphor-icons/react'
import type { ComponentType } from 'react'
import { paths } from '@/app/router/paths'
import type { Permission } from '@/shared/types'

export interface NavItem {
  to: string
  /** i18n key in the `common` namespace. */
  labelKey: string
  icon: ComponentType<IconProps>
  /** When set, the item is hidden unless the user holds this permission. */
  permission?: Permission
}

/** Single source of truth for the primary navigation. New phases add rows here. */
export const navItems: NavItem[] = [
  { to: paths.dashboard, labelKey: 'nav.dashboard', icon: House },
  {
    to: paths.projects,
    labelKey: 'nav.projects',
    icon: FolderOpen,
    permission: 'estimates:read',
  },
  {
    to: paths.materials,
    labelKey: 'nav.materials',
    icon: Cube,
    permission: 'materials:read',
  },
  {
    to: paths.suppliers,
    labelKey: 'nav.suppliers',
    icon: Buildings,
    permission: 'materials:read',
  },
  { to: paths.users, labelKey: 'nav.users', icon: Users, permission: 'users:read' },
]
