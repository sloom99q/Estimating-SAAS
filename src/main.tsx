// Mantine styles first (CSS layers), then fonts, then our overrides — order
// determines the cascade. `styles.layer.css` wraps Mantine in @layer mantine.
import '@mantine/core/styles.layer.css'
import '@mantine/notifications/styles.layer.css'

import '@fontsource-variable/geist/index.css'
import '@fontsource-variable/geist-mono/index.css'
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/ibm-plex-sans-arabic/700.css'

import './styles/global.css'

// Initialize i18next (singleton) before the app renders.
import './shared/lib/i18n/i18n'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { AppProviders } from './app/providers/AppProviders'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root was not found in index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
)
