import { useDirection } from '@mantine/core'
import type { IconProps } from '@phosphor-icons/react'
import type { ComponentType } from 'react'

interface DirectionalIconProps extends IconProps {
  icon: ComponentType<IconProps>
}

/**
 * Wrapper for *directional* glyphs (carets, arrows, chevrons). Mantine's RTL
 * flips layout but never mirrors icon SVGs, so a "next" caret would point the
 * wrong way in Arabic. This mirrors the glyph in RTL only. Never use it for
 * non-directional icons (logos, clocks, checkmarks).
 */
export function DirectionalIcon({ icon: Icon, style, ...props }: DirectionalIconProps) {
  const { dir } = useDirection()
  return (
    <Icon
      {...props}
      style={{ ...style, transform: dir === 'rtl' ? 'scaleX(-1)' : undefined }}
    />
  )
}
