import React, { useState, useEffect, useRef } from 'react'
import './ChatPanel.css'

export default function ChatPanel({ onShadyMessage, shadyReply, isOpen, onClose }) {
  const [msgs, setMsgs]         = useState([])
  const [input, setInput]       = useState('')
  const [myId, setMyId]         = useState(null)
  const [myName, setMyName]     = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput]     = useState('')
  const [target, setTarget]     = useState('group')  // 'group' | 'shady'
  const wsRef    = useRef(null)
  const bottomRef= useRef(null)

  // connect to group chat WebSocket
  useEffect(() => {
    const url = `ws://${location.hostname}:${location.port}/chat`
    const ws  = new WebSocket(url)
    wsRef.current = ws

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'init') {
          setMyId(msg.id)
          setMyName(msg.name)
          setNameInput(msg.name)
          setMsgs(msg.history || [])
        } else {
          setMsgs(prev => [...prev, msg])
        }
      } catch {}
    }
    ws.onerror = () => {}
    return () => ws.close()
  }, [])

  // Shady's replies appear in chat too
  useEffect(() => {
    if (!shadyReply || shadyReply === '...') return
    const msg = { type: 'shady', name: 'Shady', text: shadyReply, ts: Date.now() }
    setMsgs(prev => [...prev, msg])
  }, [shadyReply])

  // auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, isOpen])

  function send() {
    const text = input.trim()
    if (!text) return
    setInput('')

    if (target === 'shady') {
      // send to Shady AI
      onShadyMessage(text)
      // also show in group chat as your message
      wsRef.current?.send(JSON.stringify({ text: `[to Shady] ${text}` }))
    } else {
      // group chat broadcast
      wsRef.current?.send(JSON.stringify({ text }))
    }
  }

  function saveName() {
    const n = nameInput.trim().slice(0, 20)
    if (!n) return
    setMyName(n)
    setEditingName(false)
    wsRef.current?.send(JSON.stringify({ text: '', displayName: n }))
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className={`cp-panel ${isOpen ? 'cp-panel--open' : ''}`}>
      <div className="cp-header">
        <div className="cp-header-left">
          {editingName ? (
            <form onSubmit={e => { e.preventDefault(); saveName() }} className="cp-name-form">
              <input
                className="cp-name-input"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                autoFocus
                maxLength={20}
              />
              <button type="submit" className="cp-name-save">OK</button>
            </form>
          ) : (
            <button className="cp-myname" onClick={() => setEditingName(true)}>
              {myName} <span className="cp-myname-edit">✎</span>
            </button>
          )}
        </div>

        <div className="cp-tabs">
          <button
            className={`cp-tab ${target === 'group' ? 'cp-tab--on' : ''}`}
            onClick={() => setTarget('group')}>
            Group
          </button>
          <button
            className={`cp-tab ${target === 'shady' ? 'cp-tab--shady' : ''}`}
            onClick={() => setTarget('shady')}>
            Shady
          </button>
        </div>

        <button className="cp-close" onClick={onClose}>✕</button>
      </div>

      <div className="cp-messages">
        {msgs.map((m, i) => {
          const isMe    = m.id === myId
          const isShady = m.type === 'shady'
          const isSys   = m.type === 'system'

          if (isSys) return (
            <div key={i} className="cp-sys">{m.text}</div>
          )

          return (
            <div key={i} className={`cp-msg ${isMe ? 'cp-msg--me' : ''} ${isShady ? 'cp-msg--shady' : ''}`}>
              {!isMe && <span className="cp-sender">{isShady ? '✦ Shady' : m.name}</span>}
              <div className="cp-bubble">{m.text}</div>
              {m.ts && <span className="cp-time">{formatTime(m.ts)}</span>}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="cp-input-row">
        <div className={`cp-target-dot ${target === 'shady' ? 'cp-target-dot--shady' : ''}`} />
        <input
          className="cp-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder={target === 'shady' ? 'Talk to Shady…' : 'Say something…'}
        />
        <button className="cp-send" onClick={send}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
