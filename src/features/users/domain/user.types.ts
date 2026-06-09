import type { ID, ISODateString, Role } from '@/shared/types'

export type UserStatus = 'active' | 'invited' | 'disabled'

export interface OrgUser {
  id: ID
  fullName: string
  email: string
  role: Role
  status: UserStatus
  lastActiveAt: ISODateString | null
  avatarUrl: string | null
}
