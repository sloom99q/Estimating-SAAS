import {
  DirectionProvider,
  localStorageColorSchemeManager,
  MantineProvider,
} from '@mantine/core'
import { ModalsProvider } from '@mantine/modals'
import { Notifications } from '@mantine/notifications'
import { IconContext } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { STORAGE_KEYS } from '@/shared/config/constants'
import { cssVariablesResolver, theme } from '@/theme'

// Mantine owns the color-scheme preference (single source of truth). The key
// matches index.html's pre-paint script so there is no flash on load.
const colorSchemeManager = localStorageColorSchemeManager({ key: STORAGE_KEYS.colorScheme })

const initialDirection =
  typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'

/**
 * Design-system provider. DirectionProvider wraps MantineProvider (required for
 * RTL) and auto-subscribes to the `dir` attribute on <html>, which i18next
 * keeps in sync. IconContext sets global Phosphor defaults so feature code
 * never repeats size/weight props.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <DirectionProvider initialDirection={initialDirection} detectDirection>
      <MantineProvider
        theme={theme}
        cssVariablesResolver={cssVariablesResolver}
        colorSchemeManager={colorSchemeManager}
        defaultColorScheme="light"
      >
        <IconContext.Provider value={{ size: 18, weight: 'regular' }}>
          <Notifications position="top-right" />
          <ModalsProvider>{children}</ModalsProvider>
        </IconContext.Provider>
      </MantineProvider>
    </DirectionProvider>
  )
}
