import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// in-memory chat history (max 100 messages)
const chatHistory = []
const chatClients = new Map()   // ws → { id, name }
let nextGuestId = 1

export default defineConfig({
  plugins: [
    react(),

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
