import { createTheme } from '@mantine/core'
import { components } from './components'
import { danger, dark, gray, info, ink, success, warn } from './tokens/colors'
import { radius } from './tokens/radius'
import { shadows } from './tokens/shadows'
import { spacing } from './tokens/spacing'
import { fontFamily, fontFamilyMonospace, headings } from './tokens/typography'

/**
 * The application theme — the single source of truth for the design system.
 * Consumed by ThemeProvider together with {@link cssVariablesResolver}.
 */
export const theme = createTheme({
  primaryColor: 'ink',
  // Near-black primary action in light mode; near-white (inverted) in dark.
  primaryShade: { light: 8, dark: 0 },
  // Guarantees readable button text against any computed background (WCAG).
  autoContrast: true,

  white: '#ffffff',
  black: '#161614',

  defaultRadius: 'sm',
  focusRing: 'auto',
  cursorType: 'pointer',
  fontSmoothing: true,

  fontFamily,
  fontFamilyMonospace,
  headings,

  radius,
  spacing,
  shadows,

  colors: { ink, gray, dark, success, warn, danger, info },

  components,
})

export { cssVariablesResolver } from './cssVariablesResolver'
