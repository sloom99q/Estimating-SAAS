import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Single source of truth for the `@` alias — mirrored in tsconfig.app.json.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    // Phosphor ships thousands of icon modules; pre-bundling it stops Vite's dev
    // server from crawling them on every cold start (near-exponential slowdown).
    include: ['@phosphor-icons/react'],
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Stable vendor chunks so a normal app change does not invalidate the
        // heavy framework bundles, keeping browser cache hit-rates high.
        manualChunks: (id) => {
          if (!id.includes('/node_modules/')) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) {
            return 'vendor-react'
          }
          if (id.includes('@mantine')) return 'vendor-mantine'
          if (id.includes('@tanstack')) return 'vendor-query'
          if (id.includes('i18next')) return 'vendor-i18n'
          return undefined
        },
      },
    },
  },
})
