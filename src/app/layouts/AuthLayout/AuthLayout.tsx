import { Box, Center, Group } from '@mantine/core'
import { Outlet } from 'react-router'
import { LanguageToggle, Logo, ThemeToggle } from '@/shared/ui'

/** Minimal centered shell for unauthenticated pages (login). */
export function AuthLayout() {
  return (
    <Box style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <Group justify="space-between" p="md">
        <Logo />
        <Group gap="xs">
          <ThemeToggle />
          <LanguageToggle />
        </Group>
      </Group>
      <Center style={{ flex: 1 }} p="md">
        <Outlet />
      </Center>
    </Box>
  )
}
