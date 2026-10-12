import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const serverPort = Number(process.env.AGENT_TEST_PORT ?? 4100)

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${serverPort}` },
  },
  build: { outDir: '../dist', emptyOutDir: true },
})
