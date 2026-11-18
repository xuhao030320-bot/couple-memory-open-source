import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { writeOfflineWorker } from './scripts/build-service-worker.mjs'
import { pageFlipLifecycle } from './scripts/page-flip-lifecycle.mjs'
import { checkPublicEnv } from './scripts/public-env.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  checkPublicEnv(env)
  const provider = process.env.VITE_DATA_PROVIDER || env.VITE_DATA_PROVIDER || 'local'
  return {
  plugins: [pageFlipLifecycle(), react(), {
    name: 'only-ours-offline-shell', apply: 'build',
    closeBundle: () => writeOfflineWorker(process.cwd(), provider),
  }],
  build: { manifest: true },
  optimizeDeps: { exclude: ['react-pageflip', 'page-flip'] },
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  }
})
