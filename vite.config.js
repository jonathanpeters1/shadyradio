import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import https from 'https'
import http from 'http'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'stream-proxy',
      configureServer(server) {
        server.middlewares.use('/stream-proxy', (req, res) => {
          const streamUrl = new URL('http://localhost' + req.url).searchParams.get('url')
          if (!streamUrl) { res.statusCode = 400; res.end('missing url'); return }

          const mod = streamUrl.startsWith('https') ? https : http
          const proxyReq = mod.get(streamUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; ShadyRadio/1.0)',
              'Icy-MetaData': '0',
            }
          }, (proxyRes) => {
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'audio/mpeg')
            res.setHeader('Transfer-Encoding', 'chunked')
            res.statusCode = proxyRes.statusCode || 200
            proxyRes.pipe(res)
            proxyRes.on('error', () => res.end())
          })

          proxyReq.on('error', () => { res.statusCode = 502; res.end() })
          req.on('close', () => proxyReq.destroy())
        })
      }
    }
  ],
  server: {
    host: true,
    port: 3000,
  }
})
