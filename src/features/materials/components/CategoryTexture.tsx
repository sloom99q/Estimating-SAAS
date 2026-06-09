import { useId } from 'react'
import type { CategoryPattern } from '../domain/category-visuals'

/**
 * SVG <pattern> primitives, one per category pattern. Strokes/fills use
 * `currentColor` so the texture inherits whatever ink the parent sets — which
 * means light/dark mode flips automatically without conditional logic, and a
 * caller can tint the pattern simply by setting `color` on the surrounding
 * element. Patterns are intentionally subtle so they read as a hint, not as
 * Awwwards-style decoration.
 */

interface CategoryTextureProps {
  pattern: CategoryPattern
  /**
   * Width × height of the rendered patch. The default 320×120 fits inside a
   * MaterialCard thumbnail; the SpacePlan2D supplies its own dimensions.
   */
  width?: number
  height?: number
  /** Opacity 0–1 applied to the foreground strokes/fills. Default `0.32`. */
  opacity?: number
  /** Optional rounded corners — e.g. to match a card radius. */
  borderRadius?: number
  /** Pure-SVG mode: when true, returns just the `<rect>` filled with the pattern. */
  asSvg?: boolean
}

export function CategoryTexture({
  pattern,
  width = 320,
  height = 120,
  opacity = 0.32,
  borderRadius = 0,
  asSvg = false,
}: CategoryTextureProps) {
  const id = useId()
  const patternId = `cat-pattern-${pattern}-${id.replace(/[:]/g, '')}`
  const definition = renderPatternDefinition(pattern, patternId, opacity)

  if (asSvg) {
    return (
      <>
        {definition}
        <rect width={width} height={height} fill={`url(#${patternId})`} />
      </>
    )
  }

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid slice"
      style={{ display: 'block', borderRadius }}
      aria-hidden
    >
      <defs>{definition}</defs>
      <rect width={width} height={height} fill={`url(#${patternId})`} />
    </svg>
  )
}

function renderPatternDefinition(
  pattern: CategoryPattern,
  id: string,
  opacity: number,
) {
  // currentColor lets the texture inherit the surrounding ink tone (and flip
  // automatically with the color scheme). Each pattern uses a different unit
  // so the visual rhythm is distinct without changing the swatch color.
  switch (pattern) {
    case 'grid':
      return (
        <pattern id={id} width={28} height={28} patternUnits="userSpaceOnUse">
          <rect width={28} height={28} fill="currentColor" fillOpacity={opacity * 0.18} />
          <path
            d="M 28 0 L 0 0 0 28"
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            strokeOpacity={opacity}
          />
        </pattern>
      )
    case 'veined':
      return (
        <pattern id={id} width={120} height={70} patternUnits="userSpaceOnUse">
          <rect width={120} height={70} fill="currentColor" fillOpacity={opacity * 0.15} />
          <path
            d="M0 50 C 30 30 60 80 120 35"
            stroke="currentColor"
            strokeOpacity={opacity * 0.7}
            strokeWidth={1.2}
            fill="none"
          />
          <path
            d="M0 18 C 40 5 80 40 120 12"
            stroke="currentColor"
            strokeOpacity={opacity * 0.4}
            strokeWidth={0.8}
            fill="none"
          />
        </pattern>
      )
    case 'wash':
      return (
        <pattern id={id} width={1} height={1} patternUnits="userSpaceOnUse">
          <rect width={1} height={1} fill="currentColor" fillOpacity={opacity * 0.45} />
        </pattern>
      )
    case 'panel':
      return (
        <pattern id={id} width={70} height={70} patternUnits="userSpaceOnUse">
          <rect width={70} height={70} fill="currentColor" fillOpacity={opacity * 0.15} />
          <line
            x1={0}
            y1={35}
            x2={70}
            y2={35}
            stroke="currentColor"
            strokeOpacity={opacity}
            strokeWidth={0.8}
          />
        </pattern>
      )
    case 'dots':
      return (
        <pattern id={id} width={14} height={14} patternUnits="userSpaceOnUse">
          <rect width={14} height={14} fill="currentColor" fillOpacity={opacity * 0.18} />
          <circle cx={7} cy={7} r={1.2} fill="currentColor" fillOpacity={opacity} />
        </pattern>
      )
    case 'lines':
      return (
        <pattern id={id} width={10} height={10} patternUnits="userSpaceOnUse">
          <rect width={10} height={10} fill="currentColor" fillOpacity={opacity * 0.2} />
          <line
            x1={0}
            y1={5}
            x2={10}
            y2={5}
            stroke="currentColor"
            strokeOpacity={opacity}
            strokeWidth={0.6}
          />
        </pattern>
      )
    case 'planks':
      return (
        <pattern id={id} width={28} height={80} patternUnits="userSpaceOnUse">
          <rect width={28} height={80} fill="currentColor" fillOpacity={opacity * 0.22} />
          <line
            x1={14}
            y1={0}
            x2={14}
            y2={80}
            stroke="currentColor"
            strokeOpacity={opacity * 0.6}
            strokeWidth={0.8}
          />
        </pattern>
      )
    case 'solid':
      return (
        <pattern id={id} width={1} height={1} patternUnits="userSpaceOnUse">
          <rect width={1} height={1} fill="currentColor" fillOpacity={opacity * 0.25} />
        </pattern>
      )
  }
}
