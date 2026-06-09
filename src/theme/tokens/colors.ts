import type { MantineColorsTuple } from '@mantine/core'

/**
 * Color system — a translation of the `minimalist-ui` skill into Mantine tokens.
 *
 * Principles enforced here:
 *  - Warm monochrome canvas, white surfaces, hairline borders.
 *  - Color is a scarce resource: one near-black "ink" drives all primary action;
 *    semantic hues appear only as muted pastels on badges/statuses.
 *  - Text is never pure black; borders are ultra-light.
 *
 * Scales are 10-step Mantine tuples (index 0 = lightest … 9 = darkest).
 */

/** Neutral near-black ramp — primaryColor. Buttons land on shade 8 (light). */
export const ink: MantineColorsTuple = [
  '#f7f7f6',
  '#e9e9e7',
  '#d2d2cf',
  '#b8b8b4',
  '#9c9c97',
  '#7c7c77',
  '#5e5e59',
  '#444440',
  '#2a2a27',
  '#161614',
]

/** Warm-tinted gray — borders, dividers, dimmed text, subtle fills (light mode). */
export const gray: MantineColorsTuple = [
  '#fafaf9',
  '#f5f5f3',
  '#ececea',
  '#e2e1de',
  '#cdccc7',
  '#a8a7a1',
  '#78776f',
  '#5a5953',
  '#3d3c37',
  '#26251f',
]

/** Warm charcoal — dark-mode surfaces, borders and text. */
export const dark: MantineColorsTuple = [
  '#edece9',
  '#c8c7c2',
  '#a6a59f',
  '#82817b',
  '#5b5a54',
  '#403f3a',
  '#2a2925',
  '#1d1c1e',
  '#161517',
  '#0f0e10',
]

/** Muted green — success / approved / won. Light variant ≈ #eef4ec, text ≈ #346538. */
export const success: MantineColorsTuple = [
  '#eef4ec',
  '#d8e7d6',
  '#b3d0b0',
  '#8cba88',
  '#6aa765',
  '#4f9a4a',
  '#3f8a3f',
  '#346538',
  '#294f2c',
  '#1e3a21',
]

/** Muted amber — warning / pending / draft. Light variant ≈ #fbf3db, text ≈ #956400. */
export const warn: MantineColorsTuple = [
  '#fbf3db',
  '#f5e6b8',
  '#edd083',
  '#e4ba4f',
  '#dca828',
  '#cf9a18',
  '#b88112',
  '#956400',
  '#6f4b00',
  '#4a3200',
]

/** Muted red — danger / rejected / lost. Light variant ≈ #fdecec, text ≈ #9f2f2d. */
export const danger: MantineColorsTuple = [
  '#fdecec',
  '#f8d4d5',
  '#f0aaac',
  '#e87f82',
  '#e15a5e',
  '#d8474b',
  '#c43c40',
  '#9f2f2d',
  '#82282a',
  '#5f1d1f',
]

/** Muted blue — informational / in-progress / links. Light variant ≈ #e3f3fe, text ≈ #1f6c9f. */
export const info: MantineColorsTuple = [
  '#e3f3fe',
  '#c2e4fb',
  '#93cef6',
  '#63b7f1',
  '#3ea4ee',
  '#2098ec',
  '#1184d6',
  '#1f6c9f',
  '#1a567c',
  '#143f5b',
]

/**
 * Semantic surface/border/text tokens, applied to Mantine's built-in CSS
 * variables (and a few `--app-*` ones) per color scheme by the resolver.
 * Keeping these as plain objects makes the design intent legible and is the
 * single source for "bone canvas, white surfaces, hairline borders".
 */
export const lightTokens = {
  canvas: '#f7f6f3', // warm bone — page background behind surfaces
  surface: '#ffffff', // cards, header, navbar
  surfaceMuted: '#f9f9f8', // subtle fills, hovered rows
  border: '#eaeaea', // hairline dividers
  text: '#1a1a1a', // off-black, never #000
  dimmed: '#787774', // muted secondary text
} as const

export const darkTokens = {
  canvas: '#171618',
  surface: '#211f22',
  surfaceMuted: '#1c1b1d',
  border: 'rgba(255, 255, 255, 0.09)',
  text: '#ecebe8',
  dimmed: '#9a9893',
} as const
