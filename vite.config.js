import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    host: true,
    port: 3000,
    proxy: {
      // Audio server on :3003 — serves music files + beat grid playlists
      '/music': {
        target: 'http://localhost:3003',
        changeOrigin: true,
      },
      '/api/playlist': {
        target: 'http://localhost:3003',
        changeOrigin: true,
      },
      '/api/analyze': {
        target: 'http://localhost:3003',
        changeOrigin: true,
      },
      '/api/confirm': {
        target: 'http://localhost:3003',
        changeOrigin: true,
      },
    }
  }
})
