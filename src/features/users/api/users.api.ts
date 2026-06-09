import type { OrgUser } from '../domain/user.types'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const MOCK_USERS: OrgUser[] = [
  {
    id: 'usr_demo_owner',
    fullName: 'Layla Haddad',
    email: 'layla.haddad@aurorafitout.com',
    role: 'owner',
    status: 'active',
    lastActiveAt: '2026-06-08T14:25:00.000Z',
    avatarUrl: null,
  },
  {
    id: 'usr_2',
    fullName: 'Omar Farouk',
    email: 'omar.farouk@aurorafitout.com',
    role: 'admin',
    status: 'active',
    lastActiveAt: '2026-06-08T09:10:00.000Z',
    avatarUrl: null,
  },
  {
    id: 'usr_3',
    fullName: 'Priya Nair',
    email: 'priya.nair@aurorafitout.com',
    role: 'estimator',
    status: 'active',
    lastActiveAt: '2026-06-07T17:40:00.000Z',
    avatarUrl: null,
  },
  {
    id: 'usr_4',
    fullName: 'Daniel Okafor',
    email: 'daniel.okafor@aurorafitout.com',
    role: 'estimator',
    status: 'invited',
    lastActiveAt: null,
    avatarUrl: null,
  },
  {
    id: 'usr_5',
    fullName: 'Sara Khalil',
    email: 'sara.khalil@aurorafitout.com',
    role: 'viewer',
    status: 'active',
    lastActiveAt: '2026-06-05T11:05:00.000Z',
    avatarUrl: null,
  },
  {
    id: 'usr_6',
    fullName: 'Mateo Rossi',
    email: 'mateo.rossi@aurorafitout.com',
    role: 'viewer',
    status: 'disabled',
    lastActiveAt: '2026-04-21T08:30:00.000Z',
    avatarUrl: null,
  },
]

/** Mock users transport. Real backend slots in here against the http client. */
export async function fetchUsers(_organizationId: string): Promise<OrgUser[]> {
  await delay(350)
  return MOCK_USERS
}
