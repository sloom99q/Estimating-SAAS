import { ActionIcon, Badge, Button, Card, Table, Title, Tooltip } from '@mantine/core'

/**
 * Per-component defaults (Mantine 9 `Component.extend`). This is the canonical,
 * type-safe place to encode the design language so feature code never has to
 * scatter style props. Cards lean on borders not shadows; everything is flat.
 */
export const components = {
  Button: Button.extend({
    styles: { root: { fontWeight: 500 } },
  }),

  Card: Card.extend({
    defaultProps: {
      withBorder: true,
      shadow: 'none',
      radius: 'md',
      padding: 'lg',
    },
  }),

  Badge: Badge.extend({
    defaultProps: {
      variant: 'light',
      radius: 'sm',
    },
    styles: { root: { fontWeight: 600, textTransform: 'none' } },
  }),

  ActionIcon: ActionIcon.extend({
    defaultProps: { variant: 'subtle', color: 'gray' },
  }),

  Tooltip: Tooltip.extend({
    defaultProps: { radius: 'sm', fz: 'xs', withArrow: true },
  }),

  Title: Title.extend({
    styles: { root: { letterSpacing: '-0.02em' } },
  }),

  Table: Table.extend({
    defaultProps: { verticalSpacing: 'sm', horizontalSpacing: 'md', highlightOnHover: true },
  }),
}
