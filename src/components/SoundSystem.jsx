import React, { useState, useEffect, useRef } from 'react'
import SpeakerCell from './SpeakerCell'
import SFParticleField from './SFParticleField'
import SFCamera from './SFCamera'
import SFHeroSphere from './SFHeroSphere'
import ShadyStage from './ShadyStage'
import ShadyProps from './ShadyProps'
import './SoundSystem.css'

const GENRES = [
  { name: 'House',                    slug: 'house' },
  { name: 'Afro House',               slug: 'afro-house' },
  { name: 'Deep House',               slug: 'deep-house' },
  { name: 'Tech House',               slug: 'tech-house' },
  { name: "Jackin' House",            slug: 'jackin-house' },
  { name: 'Melodic House & Tech…',    slug: 'melodic-house-techno' },
  { name: 'Indie Dance',              slug: 'indie-dance' },
  { name: 'Techno Peak Time Dri…',   slug: 'techno-peak' },
  { name: 'Techno Raw Deep Hypn…',   slug: 'techno-raw' },
  { name: 'Hard Techno',              slug: 'hard-techno' },
  { name: 'Minimal / Deep Tech',      slug: 'minimal-deep-tech' },
  { name: 'Nu Disco',                 slug: 'nu-disco' },
  { name: 'JP Sets',                  slug: 'jp-sets' },
  { name: 'JP Classics',              slug: 'jp-classics' },
  { name: 'Amapiano',                 slug: 'amapiano' },
  { name: 'Soulful Funk & Disco',     slug: 'soul-funk-disco' },
]

export default function SoundSystem() {
  const [active, setActive]         = useState(null)
  const [isPlaying, setIsPlaying]   = useState(false)
  const [bass, setBass]             = useState(0)
  const [treble, setTreble]         = useState(0)
  const [bands, setBands]           = useState(() => new Array(16).fill(0))
  const [mixMode, setMixMode]       = useState('radio')
  const [shadyInput, setShadyInput]   = useState('')
  const [shadyReply, setShadyReply]   = useState('')
  const [shadyBusy, setShadyBusy]     = useState(false)
  const [shadyWords, setShadyWords]   = useState([])
  const [particleBurst, setParticleBurst] = useState(null)
  const [mouthOpen, setMouthOpen]     = useState(0)
  const [cameraOn, setCameraOn]       = useState(false)
  const [gridMode, setGridMode]       = useState(false)
  const [openBox, setOpenBox]         = useState(null)
  const [fxMode, setFxMode]           = useState(false)
  const wsRef       = useRef(null)
  const analyserRef = useRef(null)
  const mouthRafRef = useRef(0)
  const canvasAreaRef = useRef(null)

  // WebSocket bridge to native audio engine (ws://localhost:8080)
  // Falls back to simulated bass so the UI still looks alive
  useEffect(() => {
    let ws = null, retry = null, simRaf = 0, simT = 0, connected = false

    function startSim() {
      if (connected) return
      const tick = () => {
        simT += 0.016
        setBass(b => {
          if (!isPlaying) return 0
          return Math.max(0, Math.sin(simT * 2.1) * 0.45 + Math.sin(simT * 5.3) * 0.15 + 0.28)
        })
        // 16-band frequency simulation — each speaker gets its own frequency slice
        setBands(() => {
          if (!isPlaying) return new Array(16).fill(0)
          return Array.from({ length: 16 }, (_, i) => {
            // logarithmic spread: low bands at i=0, highs at i=15
            const fBase = 0.9 + Math.pow(i / 15, 1.4) * 5.5
            const fHarm = fBase * (1.7 + (i % 3) * 0.4)
            // sharp transient peaks + sustain
            const raw = Math.sin(simT * fBase + i * 0.55) * 0.48
                      + Math.sin(simT * fHarm) * 0.22
                      + Math.max(0, Math.sin(simT * 2.1)) * (i < 4 ? 0.35 : 0.12) // kick hits bass bands hard
            return Math.max(0, Math.min(1, raw + 0.28))
          })
        })
        simRaf = requestAnimationFrame(tick)
      }
      simRaf = requestAnimationFrame(tick)
    }

    function connect() {
      try {
        ws = new WebSocket('ws://localhost:8080')
        wsRef.current = ws
        ws.onopen = () => { connected = true; cancelAnimationFrame(simRaf) }
        ws.onmessage = (e) => {
          const raw = e.data
          if (raw.startsWith('METER:')) {
            const vals = raw.slice(7).trim().split(/\s+/).map(Number)
            if (vals.length >= 16) {
              setBass(vals[0] ?? 0)
              setTreble(vals.slice(8).reduce((a, v) => a + v, 0) / 8)
            }
          } else {
            try {
              const msg = JSON.parse(raw)
              if (msg.type === 'meter' && Array.isArray(msg.values)) {
                setBass(msg.values[0] ?? 0)
                setTreble(msg.values.slice(8).reduce((a, v) => a + v, 0) / 8)
              }
            } catch {}
          }
        }
        ws.onclose = () => { connected = false; wsRef.current = null; startSim(); retry = setTimeout(connect, 2500) }
        ws.onerror = () => ws?.close()
      } catch {
        startSim()
      }
    }

    connect()
    startSim() // start sim immediately; connect() cancels it if WS opens

    return () => {
      if (retry) clearTimeout(retry)
      cancelAnimationFrame(simRaf)
      ws?.close()
    }
  }, [])

  // Pause sim when nothing is playing
  useEffect(() => { if (!isPlaying) setBass(0) }, [isPlaying])

  function tapGenre(slug) {
    if (active === slug) {
      setActive(null); setIsPlaying(false)
    } else {
      setActive(slug); setIsPlaying(true)
    }
  }

  async function sendToShady() {
    const text = shadyInput.trim()
    if (!text || shadyBusy) return
    setShadyBusy(true); setShadyInput(''); setShadyReply('...')
    try {
      // get reply text
      const res = await fetch('http://192.168.1.167:8099/shady', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      const { reply } = await res.json()
      if (!reply || reply.trim() === '.') { setShadyReply(''); return }
      setShadyReply(reply)

      // Parse reply for visual effects
      const words = reply.split(' ')
      const wordAnimations = words.map((word, index) => {
        const upperWord = word.toUpperCase().replace(/[^A-Z]/g, '')
        
        return {
          text: word,
          type: ['GIRL', 'HONEY', 'BITCH', 'QUEEN'].includes(upperWord) ? 'fire' :
                ['PERIOD', 'ICONIC', 'LEGENDARY', 'FIRE'].includes(upperWord) ? 'snap' :
                word.includes('*') || word.includes('_') ? 'shade' : 'regular',
          delay: index * 200,
          x: Math.random() * 60 + 20,
          y: Math.random() * 40 + 30
        }
      })

      setShadyWords(wordAnimations)

      const hasSnapWord = wordAnimations.some(w => w.type === 'snap')
      if (hasSnapWord) {
        setParticleBurst({ x: Math.random() * 100, y: Math.random() * 100 })
        setTimeout(() => setParticleBurst(null), 1000)
      }

      setTimeout(() => setShadyWords([]), 3000)

      // TTS → real-time lip sync
      const speakRes = await fetch('http://192.168.1.167:8099/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: reply }),
      })
      if (speakRes.ok) {
        const blob  = await speakRes.blob()
        const url   = URL.createObjectURL(blob)
        const audio = new Audio(url)

        // Web Audio analyser drives mouthOpen → lip particles
        try {
          const actx     = new (window.AudioContext || window.webkitAudioContext)()
          const src      = actx.createMediaElementSource(audio)
          const analyser = actx.createAnalyser()
          analyser.fftSize = 256
          src.connect(analyser); analyser.connect(actx.destination)
          const buf = new Uint8Array(analyser.frequencyBinCount)
          cancelAnimationFrame(mouthRafRef.current)
          const tick = () => {
            analyser.getByteTimeDomainData(buf)
            let rms = 0
            for (let i = 0; i < buf.length; i++) rms += (buf[i] - 128) ** 2
            setMouthOpen(Math.min(1, Math.sqrt(rms / buf.length) / 12))
            mouthRafRef.current = requestAnimationFrame(tick)
          }
          tick()
        } catch {}

        await audio.play()

        audio.onended = () => {
          URL.revokeObjectURL(url)
          cancelAnimationFrame(mouthRafRef.current)
          setMouthOpen(0)
        }
        await audio.play()
      }
    } catch { setShadyReply('') }
    finally { setShadyBusy(false) }
  }

  const activeGenre = GENRES.find(g => g.slug === active)

  return (
    <div className="ss-root">

      {/* ── header ── */}
      <header className="ss-header">
        <div className="ss-logo">
          <img src="/sf-logo.jpeg" alt="SF" className="ss-logo-img" />
          <span className="ss-logo-text">SF</span>
        </div>
        <p className="ss-header-title">· SOUNDFACTORY ·</p>
        <button className={`ss-cam-btn ${cameraOn ? 'ss-cam-btn--on' : ''}`}
          onClick={() => setCameraOn(v => !v)} title="Camera">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          </svg>
        </button>
      </header>

      {/* ── ONE unified canvas: particles behind, speakers on top ── */}
      <div className="ss-canvas" ref={canvasAreaRef}>
        {/* camera layer — deepest */}
        {cameraOn && <SFCamera active={cameraOn} onMotion={() => {}} />}

        {/* ── hero stage — 24/7 live screen, content TBD ── */}
        <div className="ss-hero-layer" />

        {/* particle field — full canvas, always visible */}
        <div className="ss-particle-layer">
          <SFParticleField
            bass={bass}
            treble={treble}
            isPlaying={isPlaying}
            morphToLips={shadyBusy || mixMode === 'skit'}
            mouthOpen={mouthOpen}
          />
        </div>

        {/* Shady word burst — flies on screen when she speaks */}
        <ShadyStage
          reply={shadyReply}
          isActive={shadyBusy || !!shadyReply}
          stageRef={canvasAreaRef}
        />

        {/* Shady drag queen fan — waves while she performs */}
        <ShadyProps isActive={shadyBusy || !!shadyReply} />

        {/* 4×4 speaker grid — sits over the bottom 62% of the canvas */}
        <div className="ss-grid">
          {GENRES.map((g, i) => (
            <SpeakerCell
              key={g.slug}
              genre={g}
              idx={i}
              active={active === g.slug}
              bass={isPlaying ? bass : 0}
              bandBass={isPlaying ? (bands[i] ?? 0) : 0}
              treble={isPlaying ? treble : 0}
              isPlaying={isPlaying}
              fxMode={fxMode}
              onTap={() => !gridMode && tapGenre(g.slug)}
            />
          ))}
        </div>

        {/* 32-box modular overlay — 4×8 grid across the whole canvas */}
        <div className={`ss-box-grid ${gridMode ? 'ss-box-grid--on' : ''}`}>
          {Array.from({ length: 32 }, (_, i) => (
            <button
              key={i}
              className={`ss-box-cell ${openBox === i ? 'ss-box-cell--open' : ''}`}
              onClick={() => setOpenBox(b => b === i ? null : i)}
            >
              {openBox === i && (
                <div className="ss-box-inner">
                  <span className="ss-box-idx">{String(i + 1).padStart(2, '0')}</span>
                  <span className="ss-box-hint">anything</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── bottom controls ── */}
      <div className="ss-controls">
        <div className="ss-btn-strip">

          <button className="ss-btn" title="Skip"
            onClick={() => { setActive(null); setIsPlaying(false) }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>
            </svg>
          </button>

          <button
            className={`ss-btn ss-btn--labeled ${isPlaying ? 'ss-btn--cyan' : ''}`}
            onClick={() => { if (isPlaying) { setIsPlaying(false) } else if (active) { setIsPlaying(true) } }}
          >
            {isPlaying
              ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>Pause</span></>
              : <><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Play</span></>}
          </button>

          <button className={`ss-btn ss-btn--labeled ${mixMode === 'skit' ? 'ss-btn--orange' : ''}`}
            onClick={() => setMixMode(m => m === 'skit' ? 'radio' : 'skit')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <span>Skit</span>
          </button>

          <button className={`ss-btn ss-btn--labeled ${mixMode === 'radio' ? 'ss-btn--amber' : ''}`}
            onClick={() => setMixMode('radio')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 20H2"/><circle cx="12" cy="9" r="7"/><path d="M12 2C8 2 4.5 5 4.5 9"/>
            </svg>
            <span>Radio</span>
          </button>

          <button className={`ss-btn ss-btn--labeled ${mixMode === 'club' ? 'ss-btn--fuchsia' : ''}`}
            onClick={() => setMixMode('club')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
            </svg>
            <span>Club</span>
          </button>

          <button className={`ss-btn ss-btn--labeled ${mixMode === 'vocal' ? 'ss-btn--emerald' : ''}`}
            onClick={() => setMixMode(m => m === 'vocal' ? 'radio' : 'vocal')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
            <span>Vocal</span>
          </button>

          <button className="ss-btn ss-btn--labeled ss-btn--pro">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/>
            </svg>
            <span>Pro</span>
          </button>

          <button
            className={`ss-btn ss-btn--labeled ${fxMode ? 'ss-btn--fx-on' : ''}`}
            onClick={() => setFxMode(v => !v)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            <span>FX</span>
          </button>

          <button
            className={`ss-btn ss-btn--labeled ${gridMode ? 'ss-btn--grid-on' : ''}`}
            onClick={() => { setGridMode(v => !v); setOpenBox(null) }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
            <span>Zones</span>
          </button>
        </div>

        <div className="ss-shady">
          <span className="ss-shady-dot" />
          <input
            className="ss-shady-input"
            value={shadyInput}
            onChange={e => setShadyInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendToShady() }}
            placeholder="Speak to Shady..."
            disabled={shadyBusy}
          />
          {shadyReply && <p className="ss-shady-reply">{shadyReply}</p>}
          
          {/* Word Animations */}
          {shadyWords.map((word, i) => (
            <div
              key={i}
              className={`shady-word shady-word-${word.type}`}
              style={{
                left: `${word.x}%`,
                top: `${word.y}%`,
                animationDelay: `${word.delay}ms`,
              }}
            >
              {word.text}
            </div>
          ))}
          
          {/* Particle Burst */}
          {particleBurst && (
            <div
              className="particle-burst"
              style={{
                left: `${particleBurst.x}%`,
                top: `${particleBurst.y}%`,
              }}
            />
          )}
          
          <button className="ss-shady-btn" onClick={sendToShady}
            disabled={shadyBusy || !shadyInput.trim()}>
            {shadyBusy ? '…' : 'Shady Shot'}
          </button>
        </div>
      </div>

    </div>
  )
}
