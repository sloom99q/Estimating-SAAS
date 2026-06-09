import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * domain/ is the clean-architecture core: it must stay free of any UI / data /
 * routing framework so the business rules are portable and testable. Only zod
 * (a framework-agnostic validation lib) and pure TypeScript are allowed.
 */
const DOMAIN_FRAMEWORK_FREE = {
  patterns: [
    {
      group: [
        'react',
        'react-dom',
        'react-router',
        '@mantine/*',
        '@tanstack/*',
        'zustand',
        'i18next',
        'react-i18next',
        '@/app/*',
        '@/app/*/**',
        '@/features/*',
        '@/features/*/**',
      ],
      message:
        'domain/ is the framework-free core — only `zod` and pure TypeScript are allowed here.',
    },
  ],
}

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'coverage', '**/*.config.js', '**/*.config.cjs', '**/*.config.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  /* ----------------------------------------------------------------------- *
   * Architectural dependency rule, enforced as path zones (no resolver
   * needed). Direction of allowed dependencies:  app → features → shared → theme
   * ----------------------------------------------------------------------- */
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*', '@/features/*/**', '@/app/*', '@/app/*/**'],
              message: 'shared/ is feature-agnostic: it must not import from features/ or app/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/theme/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/features/*',
                '@/features/*/**',
                '@/app/*',
                '@/app/*/**',
                '@/shared/*',
                '@/shared/*/**',
              ],
              message: 'theme/ is the lowest layer: import only theme tokens and Mantine.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/app/*', '@/app/*/**'],
              message: 'features/ must not import the app/composition layer.',
            },
            {
              group: ['@/features/*', '@/features/*/**'],
              message:
                'No cross-feature imports. Use relative paths within a feature; lift shared contracts to @/shared/types.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/**/domain/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', DOMAIN_FRAMEWORK_FREE],
    },
  },
)
