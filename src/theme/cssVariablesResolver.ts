import type { CSSVariablesResolver } from '@mantine/core'
import { darkTokens, lightTokens } from './tokens/colors'
import { fontFamilyMonospace } from './tokens/typography'

/**
 * Maps our semantic tokens onto Mantine's built-in CSS variables (and a few
 * `--app-*` ones) per color scheme. This is what produces the "bone canvas /
 * white surface / hairline border" look without hardcoding hex in components.
 *
 * Note: `--mantine-color-body` drives all surface components (Paper, Card,
 * AppShell sections), so it stays the *surface* color. The page canvas behind
 * those surfaces is `--app-canvas`, applied to <body> in styles/global.css.
 */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    // Color-scheme independent
    '--app-font-mono': fontFamilyMonospace,
  },
  light: {
    '--mantine-color-body': lightTokens.surface,
    '--mantine-color-default-border': lightTokens.border,
    '--mantine-color-text': lightTokens.text,
    '--mantine-color-dimmed': lightTokens.dimmed,
    '--app-canvas': lightTokens.canvas,
    '--app-surface': lightTokens.surface,
    '--app-surface-muted': lightTokens.surfaceMuted,
    '--app-border': lightTokens.border,
  },
  dark: {
    '--mantine-color-body': darkTokens.surface,
    '--mantine-color-default-border': darkTokens.border,
    '--mantine-color-text': darkTokens.text,
    '--mantine-color-dimmed': darkTokens.dimmed,
    '--app-canvas': darkTokens.canvas,
    '--app-surface': darkTokens.surface,
    '--app-surface-muted': darkTokens.surfaceMuted,
    '--app-border': darkTokens.border,
  },
})
