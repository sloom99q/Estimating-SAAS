import { AppShell } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Outlet } from 'react-router'
import { useNavCollapsed } from '@/shared/store/uiStore'
import { useDxfModalStore } from '@/shared/store/dxfModalStore'
import { LayerMapModal } from '@/features/dxf'
import { DashboardHeader } from './Header'
import { Sidebar } from './Sidebar'

/**
 * Desktop-first app shell: fixed header + collapsible navigation rail + main
 * content. The shell (header/nav) renders eagerly so it paints instantly while
 * the lazy page chunk loads into the Outlet. On mobile the nav becomes a drawer.
 */
export function DashboardLayout() {
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false)
  const navCollapsed = useNavCollapsed()
  // DXF MVP — global mount for the LayerMapModal. UploadCard fires the
  // open signal via the shared dxfModalStore on a .dxf upload, this
  // shell renders the modal independent of route.
  const dxfModal = useDxfModalStore()

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{
        width: navCollapsed ? 76 : 264,
        breakpoint: 'sm',
        collapsed: { mobile: !mobileOpened },
      }}
      padding="xl"
    >
      <AppShell.Header>
        <DashboardHeader mobileOpened={mobileOpened} onToggleMobile={toggleMobile} />
      </AppShell.Header>
      <AppShell.Navbar>
        <Sidebar collapsed={navCollapsed} onNavigate={closeMobile} />
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
      {dxfModal.projectId && dxfModal.documentId ? (
        <LayerMapModal
          opened={dxfModal.opened}
          onClose={dxfModal.close}
          projectId={dxfModal.projectId}
          documentId={dxfModal.documentId}
          filename={dxfModal.filename}
        />
      ) : null}
    </AppShell>
  )
}
