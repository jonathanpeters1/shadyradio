import React, { useState, useEffect, useRef } from 'react'
import SpeakerCell from './SpeakerCell'
import SFParticleField from './SFParticleField'
import SFCamera from './SFCamera'
import ShadyStage from './ShadyStage'
import ShadyProps from './ShadyProps'
import ChatPanel from './ChatPanel'
import audioManager from '../audio/audioManager'
import './SoundSystem.css'

const GENRES = [
  { name: 'House',                    slug: 'house' },
  { name: 'Afro House',               slug: 'afro-house' },
  { name: 'Deep House',               slug: 'deep-house' },
  { name: 'Tech House',               slug: 'tech-house' },
  { name: "Jackin' House",            slug: 'jackin-house' },
  { name: 'Melodic House & Tech',     slug: 'melodic-house-techno' },
  { name: 'Indie Dance',              slug: 'indie-dance' },
  { name: 'Techno Peak',              slug: 'techno-peak' },
  { name: 'Techno Raw',               slug: 'techno-raw' },
  { name: 'Hard Techno',              slug: 'hard-techno' },
  { name: 'Minimal Deep Tech',        slug: 'minimal-deep-tech' },
  { name: 'Nu Disco',                 slug: 'nu-disco' },
  { name: 'JP Sets',                  slug: 'jp-sets' },
  { name: 'JP Classics',              slug: 'jp-classics' },
  { name: 'Amapiano',                 slug: 'amapiano' },
  { name: 'Soulful Funk & Disco',     slug: 'soul-funk-disco' },
]

// Radio Browser API tag per genre
const GENRE_TAGS = {
  'house':                'house',
  'afro-house':           'afro house',
  'deep-house':           'deep house',
  'tech-house':           'tech house',
  'jackin-house':         'jackin house',
  'melodic-house-techno': 'melodic techno',
  'indie-dance':          'indie dance',
  'techno-peak':          'techno',
  'techno-raw':           'techno',
  'hard-techno':          'hard techno',
  'minimal-deep-tech':    'minimal techno',
  'nu-disco':             'nu disco',
  'jp-sets':              'house',
  'jp-classics':          'soulful house',
  'amapiano':             'amapiano',
  'soul-funk-disco':      'funk',
}

const VOCAL_SLUGS = new Set([
  'house','afro-house','jackin-house','indie-dance',
  'nu-disco','jp-sets','jp-classics','amapiano','soul-funk-disco'
])

export default function SoundSystem() {
  const [active, setActive]           = useState(null)
  const [activeChannel, setActiveChannel] = useState(-1) // WASM active channel index
  const [isPlaying, setIsPlaying]     = useState(false)
  const [loadingAudio, setLoadingAudio] = useState(false)
  const [bass, setBass]               = useState(0)
  const [treble, setTreble]           = useState(0)
  const [mixMode, setMixMode]         = useState('radio')
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
  const [chatOpen, setChatOpen]       = useState(false)
  const [crossfadeProgress, setCrossfadeProgress] = useState(0) // meter[18]
  const [activeBpm, setActiveBpm]     = useState(120) // meter[19]
  const [pendingChannel, setPendingChannel] = useState(-1) // meter[17]
  const [channelData, setChannelData] = useState(Array(16).fill({
    bpm: 0,
    bpmLocked: false,
    keyLabel: null,
    phrasePhase: 0
  }))

  // VU meter refs
  const vuCanvasRef = useRef(null)
  const vuRafRef = useRef(0)

  const wsRef           = useRef(null)
  const mouthRafRef     = useRef(0)
  const canvasAreaRef   = useRef(null)
  const audioRef        = useRef(null)
  const audioCtxRef     = useRef(null)
  const audioRafRef     = useRef(0)
  const isPlayingRef    = useRef(false)

  // sync ref on every render — no stale closure in RAF loops
  isPlayingRef.current = isPlaying

  // ── audio manager setup + meter bridge ─────────────────────────────
  useEffect(() => {
    // Set up meter callback from WASM engine
    audioManager.onMeterUpdate((meters) => {
      // meters[0-15] = channel RMS, [16] = active_channel, [17] = pending_channel
      // [18] = crossfade_progress, [19] = active_bpm
      const activeCh = Math.round(meters[16]);
      const pendingCh = Math.round(meters[17]);
      setActiveChannel(activeCh);
      setPendingChannel(pendingCh);
      setCrossfadeProgress(meters[18]);
      setActiveBpm(meters[19]);

      // Set bass from active channel's RMS (meter[activeCh])
      if (activeCh >= 0 && activeCh < 16) {
        setBass(meters[activeCh]);
        // treble proxy: active channel RMS peaks drive high-freq shimmer
        setTreble(meters[activeCh] * 2.5);
      }

      // Update per-channel data (BPM will be tracked per channel from WASM in future)
      // For now, we only know active channel BPM
      setChannelData(prev => {
        const next = [...prev];
        // Update active channel with known data
        if (activeCh >= 0 && activeCh < 16) {
          next[activeCh] = {
            ...next[activeCh],
            bpm: meters[19],
            bpmLocked: meters[19] > 0, // Locked if we have a valid BPM
            phrasePhase: meters[18] > 0 ? meters[18] : 0 // Use crossfade progress as proxy for now
          };
        }
        return next;
      });
    });

    return () => {
      audioManager.destroy();
    };
  }, []);

  // ── VU meter animation loop ───────────────────────────────────────
  useEffect(() => {
    const canvas = vuCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const barWidth = 6;
    const gap = 4;
    const height = 36;

    // Set canvas size
    canvas.width = barWidth * 2 + gap;
    canvas.height = height;

    function drawVU() {
      const [rmsL, rmsR] = audioManager.getMasterRMS();

      // Clear
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw left channel
      const hL = Math.min(height, rmsL * height * 2); // Scale up for visibility
      drawBar(ctx, 0, height - hL, barWidth, hL, rmsL);

      // Draw right channel
      const hR = Math.min(height, rmsR * height * 2);
      drawBar(ctx, barWidth + gap, height - hR, barWidth, hR, rmsR);

      vuRafRef.current = requestAnimationFrame(drawVU);
    }

    function drawBar(ctx, x, y, w, h, level) {
      // Gradient: green (0-0.7) → yellow (0.7-0.9) → red (0.9+)
      let color;
      if (level < 0.7) {
        color = '#22c55e'; // green
      } else if (level < 0.9) {
        color = '#eab308'; // yellow
      } else {
        color = '#ef4444'; // red
      }

      // Draw bar
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);

      // Draw peak indicator line
      const peakY = y;
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(x, peakY, w, 1);
    }

    vuRafRef.current = requestAnimationFrame(drawVU);

    return () => {
      cancelAnimationFrame(vuRafRef.current);
    };
  }, []);

  // ── audio engine ─────────────────────────────────────────────────────────

  async function fetchR2Track(slug) {
    const base = import.meta.env.VITE_R2_BASE_URL || ''
    if (!base) return null
    try {
      const res = await fetch(`${base}/api/random?genre=${encodeURIComponent(slug)}`)
      if (!res.ok) return null
      const data = await res.json()
      return data.url || null
    } catch {
      return null
    }
  }

  async function fetchStreamUrls(slug) {
    const tag = GENRE_TAGS[slug] || slug
    const res = await fetch(
      `https://de1.api.radio-browser.info/json/stations/bytag/${encodeURIComponent(tag)}?limit=5&hidebroken=true&order=clickcount&reverse=true`
    )
    const stations = await res.json()
    const station = stations.find(s => s.url_resolved) || stations[0]
    return station?.url_resolved || null
  }

  async function playGenre(slug, channelIndex) {
    setLoadingAudio(true)

    // Initialize audio manager on first play (needs user gesture)
    if (!audioManager.audioContext) {
      await audioManager.initialize();
    }

    try {
      let url = await fetchR2Track(slug)   // Try R2 first
      if (!url) url = await fetchStreamUrls(slug)   // Radio Browser fallback
      if (url) audioManager.play(channelIndex, url)
    } catch (e) {
      console.error('playGenre failed:', e)
    }
    setLoadingAudio(false)
  }

  // ── genre tap ─────────────────────────────────────────────────────────────
  function tapGenre(slug) {
    const channelIndex = GENRES.findIndex(g => g.slug === slug);
    if (channelIndex < 0) return;

    if (active === slug) {
      // Stop this channel
      audioManager.stop(channelIndex);
      setActive(null);
      setIsPlaying(false);
    } else {
      // Stop any currently playing channel
      if (active) {
        const prevChannel = GENRES.findIndex(g => g.slug === active);
        if (prevChannel >= 0) {
          audioManager.stop(prevChannel);
        }
      }
      // Start new channel
      setActive(slug);
      setIsPlaying(true);
      playGenre(slug, channelIndex);
    }
  }

  // ── play / pause ──────────────────────────────────────────────────────────
  function togglePlay() {
    if (isPlaying) {
      if (active) {
        const ch = GENRES.findIndex(g => g.slug === active)
        if (ch >= 0) audioManager.stop(ch)
      }
      setIsPlaying(false)
    } else {
      if (active) {
        const ch = GENRES.findIndex(g => g.slug === active)
        if (ch >= 0) { setIsPlaying(true); playGenre(active, ch) }
      }
    }
  }

  // ── skip / stop ───────────────────────────────────────────────────────────
  function skipStop() {
    if (active) {
      const ch = GENRES.findIndex(g => g.slug === active)
      if (ch >= 0) audioManager.stop(ch)
    }
    setActive(null)
    setIsPlaying(false)
  }

  // ── skit mode — auto-prompt Shady ─────────────────────────────────────────
  function activateSkit() {
    const wasAlreadySkit = mixMode === 'skit'
    setMixMode(wasAlreadySkit ? 'radio' : 'skit')
    if (!wasAlreadySkit && !shadyBusy) {
      setShadyInput('Give us a skit right now — something fierce')
      setTimeout(() => sendToShady('Give us a skit right now — something fierce'), 100)
    }
  }

  // ── Shady chat ────────────────────────────────────────────────────────────
  async function sendToShady(overrideText) {
    const text = (typeof overrideText === 'string' ? overrideText : shadyInput).trim()
    if (!text || shadyBusy) return
    setShadyBusy(true); setShadyInput(''); setShadyReply('...')
    try {
      const res = await fetch('http://192.168.1.167:8099/shady', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      const { reply } = await res.json()
      if (!reply || reply.trim() === '.') { setShadyReply(''); return }
      setShadyReply(reply)

      const words = reply.split(' ')
      const wordAnimations = words.map((word, index) => {
        const w = word.toUpperCase().replace(/[^A-Z]/g, '')
        return {
          text: word,
          type: ['GIRL','HONEY','BITCH','QUEEN'].includes(w) ? 'fire' :
                ['PERIOD','ICONIC','LEGENDARY','FIRE'].includes(w) ? 'snap' :
                word.includes('*') || word.includes('_') ? 'shade' : 'regular',
          delay: index * 200,
          x: Math.random() * 60 + 20,
          y: Math.random() * 40 + 30
        }
      })
      setShadyWords(wordAnimations)

      if (wordAnimations.some(w => w.type === 'snap')) {
        setParticleBurst({ x: Math.random() * 100, y: Math.random() * 100 })
        setTimeout(() => setParticleBurst(null), 1000)
      }
      setTimeout(() => setShadyWords([]), 3000)

      // duck music while Shady speaks
      if (audioRef.current) audioRef.current.volume = 0.18

      const speakRes = await fetch('http://192.168.1.167:8099/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: reply }),
      })
      if (speakRes.ok) {
        const blob  = await speakRes.blob()
        const url   = URL.createObjectURL(blob)
        const audio = new Audio(url)

        try {
          const actx = audioCtxRef.current || new (window.AudioContext || window.webkitAudioContext)()
          if (!audioCtxRef.current) audioCtxRef.current = actx
          if (actx.state === 'suspended') await actx.resume()
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
          if (audioRef.current) audioRef.current.volume = 1.0
        }
      }
    } catch { setShadyReply('') }
    finally { setShadyBusy(false) }
  }

  // vocal mode dims non-vocal genres
  const visibleGenres = GENRES.map(g => ({
    ...g,
    dimmed: mixMode === 'vocal' && !VOCAL_SLUGS.has(g.slug)
  }))

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

      {/* ── canvas ── */}
      <div className="ss-canvas" ref={canvasAreaRef}>
        {cameraOn && <SFCamera active={cameraOn} onMotion={() => {}} />}

        <div className="ss-hero-layer">
          {activeBpm > 0 && (
            <div className="ss-hero-bpm">
              <span className="ss-hero-bpm-number">{Math.round(activeBpm)}</span>
              <span className="ss-hero-bpm-label">BPM</span>
              {crossfadeProgress > 0 && crossfadeProgress < 1 && (
                <div className="ss-hero-xfade">
                  <div
                    className="ss-hero-xfade-fill"
                    style={{ width: `${crossfadeProgress * 100}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ss-particle-layer">
          <SFParticleField
            bass={bass}
            treble={treble}
            isPlaying={isPlaying}
            morphToLips={shadyBusy || mixMode === 'skit'}
            mouthOpen={mouthOpen}
          />
        </div>

        <ShadyStage reply={shadyReply} isActive={shadyBusy || !!shadyReply} stageRef={canvasAreaRef} />
        <ShadyProps isActive={shadyBusy || !!shadyReply} />

        {/* loading indicator */}
        {loadingAudio && (
          <div className="ss-loading">
            <span>Tuning in…</span>
          </div>
        )}

        <div className="ss-grid">
          {visibleGenres.map((g, i) => (
            <SpeakerCell
              key={g.slug}
              genre={g}
              idx={i}
              active={active === g.slug}
              activeChannel={activeChannel}
              bass={isPlaying ? bass : 0}
              bandBass={isPlaying ? bass : 0}
              treble={isPlaying ? treble : 0}
              isPlaying={isPlaying}
              fxMode={fxMode}
              dimmed={g.dimmed}
              crossfadeProgress={activeChannel === i ? crossfadeProgress : 0}
              bpm={channelData[i].bpm}
              bpmLocked={channelData[i].bpmLocked}
              keyLabel={channelData[i].keyLabel}
              phrasePhase={channelData[i].phrasePhase}
              pending={pendingChannel === i && crossfadeProgress > 0 && crossfadeProgress < 1}
              onTap={() => !gridMode && tapGenre(g.slug)}
            />
          ))}
        </div>

        <div className={`ss-box-grid ${gridMode ? 'ss-box-grid--on' : ''}`}>
          {Array.from({ length: 32 }, (_, i) => (
            <button key={i}
              className={`ss-box-cell ${openBox === i ? 'ss-box-cell--open' : ''}`}
              onClick={() => setOpenBox(b => b === i ? null : i)}>
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

      {/* ── controls ── */}
      <div className="ss-controls">
        <div className="ss-btn-strip">

          {/* skip / stop */}
          <button className="ss-btn" title="Stop" onClick={skipStop}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>
            </svg>
          </button>

          {/* play / pause */}
          <button className={`ss-btn ss-btn--labeled ${isPlaying ? 'ss-btn--cyan' : ''}`} onClick={togglePlay}>
            {isPlaying
              ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>Pause</span></>
              : <><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Play</span></>}
          </button>

          {/* skit */}
          <button className={`ss-btn ss-btn--labeled ${mixMode === 'skit' ? 'ss-btn--orange' : ''}`}
            onClick={activateSkit}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <span>Skit</span>
          </button>

          {/* radio */}
          <button className={`ss-btn ss-btn--labeled ${mixMode === 'radio' ? 'ss-btn--amber' : ''}`}
            onClick={() => setMixMode('radio')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 20H2"/><circle cx="12" cy="9" r="7"/><path d="M12 2C8 2 4.5 5 4.5 9"/>
            </svg>
            <span>Radio</span>
          </button>

          {/* club */}
          <button className={`ss-btn ss-btn--labeled ${mixMode === 'club' ? 'ss-btn--fuchsia' : ''}`}
            onClick={() => setMixMode(m => m === 'club' ? 'radio' : 'club')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
            </svg>
            <span>Club</span>
          </button>

          {/* vocal */}
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

          {/* pro */}
          <button className="ss-btn ss-btn--labeled ss-btn--pro">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/>
            </svg>
            <span>Pro</span>
          </button>

          {/* fx */}
          <button className={`ss-btn ss-btn--labeled ${fxMode ? 'ss-btn--fx-on' : ''}`}
            onClick={() => setFxMode(v => !v)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            <span>FX</span>
          </button>

          {/* zones */}
          <button className={`ss-btn ss-btn--labeled ${gridMode ? 'ss-btn--grid-on' : ''}`}
            onClick={() => { setGridMode(v => !v); setOpenBox(null) }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
            <span>Zones</span>
          </button>

          {/* chat */}
          <button className={`ss-btn ss-btn--labeled ${chatOpen ? 'ss-btn--cyan' : ''}`}
            onClick={() => setChatOpen(v => !v)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span>Chat</span>
          </button>

        </div>

        {/* ── master VU + Shady input strip ─────────────────────────────── */}
        <div className="ss-master-strip">
          {/* Left: stereo VU meter */}
          <div className="ss-vu-meter">
            <canvas ref={vuCanvasRef} className="ss-vu-canvas" />
          </div>

          {/* Center: Shady input */}
          <div className="ss-shady-center">
            {shadyReply && shadyReply !== '...' && (
              <div className="ss-shady-reply-bubble">{shadyReply}</div>
            )}
            <div className="ss-shady-input-wrap">
              <input
                type="text"
                className="ss-shady-input"
                placeholder="Ask Shady..."
                value={shadyInput}
                onChange={(e) => setShadyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendToShady()}
              />
            </div>
          </div>

          {/* Right: Shady button */}
          <button
            className="ss-shady-send-btn"
            onClick={() => sendToShady()}
            disabled={shadyBusy || !shadyInput.trim()}
          >
            Ask
          </button>
        </div>

        {/* ── chat panel (expandable) ── */}
        <ChatPanel
          isOpen={chatOpen}
          onClose={() => setChatOpen(false)}
          onShadyMessage={sendToShady}
          shadyReply={shadyReply}
        />
      </div>

      {/* flying words + particle burst rendered over full screen */}
      {shadyWords.map((word, i) => (
        <div key={i} className={`shady-word shady-word-${word.type}`}
          style={{ left: `${word.x}%`, top: `${word.y}%`, animationDelay: `${word.delay}ms` }}>
          {word.text}
        </div>
      ))}
      {particleBurst && (
        <div className="particle-burst"
          style={{ left: `${particleBurst.x}%`, top: `${particleBurst.y}%` }} />
      )}

    </div>
  )
}
