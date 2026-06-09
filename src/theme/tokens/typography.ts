/**
 * Typographic system.
 *
 * - Body/UI: Geist (a non-Inter geometric sans, per the minimalist-ui skill).
 * - Numerics/IDs/code: Geist Mono — an estimating tool is mostly numbers, so a
 *   tabular monospace gives columns that align and read precisely.
 * - Arabic: IBM Plex Sans Arabic is appended to every stack so Arabic glyphs
 *   render in a matching sans without any conditional font logic. (Latin mono
 *   has no Arabic coverage — Arabic numerics fall back to the sans with
 *   tabular-nums; see styles/global.css `.app-numeric`.)
 */

const ARABIC_FALLBACK = "'IBM Plex Sans Arabic'"

export const fontFamily = `'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ${ARABIC_FALLBACK}, 'Helvetica Neue', Arial, sans-serif`

export const fontFamilyMonospace = `'Geist Mono Variable', ui-monospace, 'SF Mono', 'JetBrains Mono', 'Liberation Mono', ${ARABIC_FALLBACK}, monospace`

export const headings = {
  fontFamily,
  fontWeight: '600',
  sizes: {
    h1: { fontSize: '1.875rem', lineHeight: '1.2', fontWeight: '600' },
    h2: { fontSize: '1.5rem', lineHeight: '1.25', fontWeight: '600' },
    h3: { fontSize: '1.25rem', lineHeight: '1.3', fontWeight: '600' },
    h4: { fontSize: '1.125rem', lineHeight: '1.35', fontWeight: '600' },
    h5: { fontSize: '1rem', lineHeight: '1.4', fontWeight: '600' },
    h6: { fontSize: '0.875rem', lineHeight: '1.4', fontWeight: '600' },
  },
} as const
