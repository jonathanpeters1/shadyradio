import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import https from 'https'
import http from 'http'

// in-memory chat history (max 100 messages)
const chatHistory = []
const chatClients = new Map()   // ws → { id, name }
let nextGuestId = 1

export default defineConfig({
  plugins: [
    react(),

    // ── stream proxy — pipes radio streams through server so browser can play ──
    {
      name: 'stream-proxy',
      configureServer(server) {
        server.middlewares.use('/stream-proxy', (req, res) => {
          const streamUrl = new URL('http://localhost' + req.url).searchParams.get('url')
          if (!streamUrl) { res.statusCode = 400; res.end('missing url'); return }
          const mod = streamUrl.startsWith('https') ? https : http
          const proxyReq = mod.get(streamUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ShadyRadio/1.0)', 'Icy-MetaData': '0' }
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
    },

    // ── group chat WebSocket server ────────────────────────────────────────────
    {
      name: 'chat-server',
      configureServer(server) {
        import('ws').then(({ WebSocketServer }) => {
          const wss = new WebSocketServer({ noServer: true })

          function broadcast(msg) {
            const str = JSON.stringify(msg)
            for (const [ws] of chatClients) {
              if (ws.readyState === 1) ws.send(str)
            }
          }

          wss.on('connection', (ws) => {
            const id   = `guest${nextGuestId++}`
            const name = id
            chatClients.set(ws, { id, name })

            // send existing history + welcome
            ws.send(JSON.stringify({ type: 'init', id, name, history: chatHistory }))
            broadcast({ type: 'system', text: `${name} joined`, ts: Date.now() })

            ws.on('message', (raw) => {
              try {
                const { text, displayName } = JSON.parse(raw.toString())
                if (!text?.trim()) return
                const client = chatClients.get(ws)
                if (displayName) client.name = displayName.slice(0, 20)
                const msg = { type: 'chat', id: client.id, name: client.name, text: text.slice(0, 280), ts: Date.now() }
                chatHistory.push(msg)
                if (chatHistory.length > 100) chatHistory.shift()
                broadcast(msg)
              } catch {}
            })

            ws.on('close', () => {
              const client = chatClients.get(ws)
              chatClients.delete(ws)
              if (client) broadcast({ type: 'system', text: `${client.name} left`, ts: Date.now() })
            })
          })

          server.httpServer.on('upgrade', (req, socket, head) => {
            if (req.url === '/chat') {
              wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
            }
          })
        }).catch(e => console.warn('chat server skipped:', e.message))
      }
    }
  ],

  server: { host: true, port: 3000 }
})
