/**
 * Mantine's required PostCSS pipeline.
 * - postcss-preset-mantine: provides the rem()/em()/light-dark()/rtl() mixins
 *   used by Mantine styles and our own CSS modules.
 * - postcss-simple-vars: exposes the Mantine breakpoint values to plain CSS
 *   media queries (e.g. `@media (max-width: $mantine-breakpoint-sm)`).
 */
module.exports = {
  plugins: {
    'postcss-preset-mantine': {},
    'postcss-simple-vars': {
      variables: {
        'mantine-breakpoint-xs': '36em',
        'mantine-breakpoint-sm': '48em',
        'mantine-breakpoint-md': '62em',
        'mantine-breakpoint-lg': '75em',
        'mantine-breakpoint-xl': '88em',
      },
    },
  },
}
