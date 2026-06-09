import React, { useState, useEffect, useRef } from 'react'
import audioManager from '../audio/audioManager'

// ─── Config ──────────────────────────────────────────────────────────────────
const BARS_PLAY  = 32   // play this many bars before crossfade
const BARS_XFADE = 8    // crossfade length in bars

// Genre slug → AUTOSYNCED folder name (mirrors audio-server.js)
const GENRE_FOLDER = {
  'tech-house':           'Tech House',
  'house':                'House',
  'afro-house':           'Afro House',
  'deep-house':           'Deep House',
  'jackin-house':         'Jackin House',
  'melodic-house-techno': 'Melodic House & Techno',
  'techno-peak':          'Techno (Peak Time Driving)',
  'techno-raw':           'Techno (Raw Deep Hypnotic)',
  'hard-techno':          'Deep Tech',
  'nu-disco':             'Nu Disco',
}

// ─── Waveform peak builder ────────────────────────────────────────────────────
function buildPeaks(audioBuffer) {
  const data = audioBuffer.getChannelData(0)
  const BS   = 256
  const n    = Math.ceil(data.length / BS)
  const max  = new Float32Array(n)
  const min  = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let mx = 0, mn = 0
    const end = Math.min((i + 1) * BS, data.length)
    for (let j = i * BS; j < end; j++) {
      if (data[j] > mx) mx = data[j]
      if (data[j] < mn) mn = data[j]
    }
    max[i] = mx; min[i] = mn
  }
  return { max, min, BS, SR: audioBuffer.sampleRate }
}

// ─── Canvas draw ─────────────────────────────────────────────────────────────
function drawDeck(canvas, peaks, track, masterBpm, currentPos, pxPerSec, crossfading, loadingPeaks) {
  if (!canvas) return
  const W = canvas.width || canvas.offsetWidth || 800
  const H = canvas.height || 90
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#060606'
  ctx.fillRect(0, 0, W, H)

  if (loadingPeaks) {
    ctx.fillStyle = '#d4a64f'; ctx.font = 'bold 12px monospace'
    ctx.fillText('loading waveform…', W / 2 - 62, H / 2 + 5)
    return
  }
  if (!track) {
    ctx.fillStyle = '#1a1a1a'; ctx.font = '12px monospace'
    ctx.fillText('— waiting for track —', W / 2 - 72, H / 2 + 4)
    return
  }

  const mBpm    = masterBpm || track.bpm
  const barDur  = (60 / mBpm) * 4
  const beatDur = barDur / 4
  const bar1rt  = track.gridOffsetSec || 0

  // Waveform
  if (peaks) {
    const { max, min, BS, SR } = peaks
    const halfH = H / 2
    for (let px = 0; px < W; px++) {
      const sec    = currentPos + (px - W / 2) / pxPerSec
      const blockI = Math.floor(sec * SR / BS)
      if (blockI < 0 || blockI >= max.length) continue
      const mx = max[blockI], mn = min[blockI]
      const y1 = halfH - mx * halfH * 0.9
      const y2 = halfH - mn * halfH * 0.9
      ctx.fillStyle = crossfading ? '#4a1a00' : '#0d2218'
      ctx.fillRect(px, y1, 1, y2 - y1 + 1)
    }
  }

  // Grid lines
  const secStart  = currentPos - (W / 2) / pxPerSec - beatDur
  const firstBeat = Math.floor((secStart - bar1rt) / beatDur) - 1
  const totalBeats = Math.ceil(W / pxPerSec / beatDur) + 4

  for (let b = firstBeat; b <= firstBeat + totalBeats; b++) {
    const t  = bar1rt + b * beatDur
    const px = Math.round((t - currentPos) * pxPerSec + W / 2)
    if (px < -2 || px > W + 2) continue
    const isBar  = b % 4 === 0
    const barNum = Math.floor(b / 4) + 1
    if (isBar) {
      if (barNum === 1 && b >= 0) {
        ctx.strokeStyle = '#0f0'; ctx.lineWidth = 3
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke()
        ctx.fillStyle = '#0f0'; ctx.font = 'bold 12px monospace'
        ctx.fillText('1', px + 3, 13)
      } else {
        const bright = barNum % 8 === 1
        ctx.strokeStyle = bright ? '#2a2a2a' : '#181818'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke()
        if (bright && barNum > 1 && px > 4 && px < W - 20) {
          ctx.fillStyle = '#333'; ctx.font = '9px monospace'
          ctx.fillText(barNum, px + 2, H - 3)
        }
      }
    } else {
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(px, H * 0.6); ctx.lineTo(px, H); ctx.stroke()
    }
  }

  // Playhead
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke()

  // Info
  ctx.fillStyle = '#333'; ctx.font = '9px monospace'
  ctx.fillText(`${track.bpm.toFixed(2)} BPM  bar1@${bar1rt.toFixed(3)}s`, 4, H - 3)
}

// ─────────────────────────────────────────────────────────────────────────────
export default function GridTool({ onClose }) {
  const [genre, setGenre]       = useState('tech-house')
  const [playlist, setPlaylist] = useState([])
  const [status, setStatus]     = useState('Select a genre and hit AUTO MIX')
  const [running, setRunning]   = useState(false)
  const [pxPerSec, setPxPerSec] = useState(160)
  const [masterBpm, setMasterBpm] = useState(null)
  const [crossfading, setCrossfading] = useState(false)
  const [xfPct, setXfPct]       = useState(0)

  // Waveform peaks
  const [peaksA, setPeaksA]     = useState(null)
  const [peaksB, setPeaksB]     = useState(null)
  const [loadingPA, setLPA]     = useState(false)
  const [loadingPB, setLPB]     = useState(false)

  // Bar.beat display
  const [deckABar, setDeckABar] = useState(null)
  const [deckBBar, setDeckBBar] = useState(null)

  const canvasA = useRef(null)
  const canvasB = useRef(null)
  const runRef  = useRef(false)

  // Deck state refs (updated by auto-mix loop, read by rAF)
  const deckA = useRef({ track: null, startCtxTime: 0, gain: null, source: null })
  const deckB = useRef({ track: null, startCtxTime: 0, gain: null, source: null })

  const masterBpmRef = useRef(null)
  const peaksARef    = useRef(null)
  const peaksBRef    = useRef(null)
  useEffect(() => { masterBpmRef.current = masterBpm },  [masterBpm])
  useEffect(() => { peaksARef.current   = peaksA },      [peaksA])
  useEffect(() => { peaksBRef.current   = peaksB },      [peaksB])

  // Load playlist when genre changes
  useEffect(() => {
    setPlaylist([])
    fetch(`/api/playlist/${genre}`)
      .then(r => r.json())
      .then(tracks => setPlaylist(tracks))
      .catch(() => setStatus('audio-server not running on :3003'))
  }, [genre])

  // rAF: draw both canvases
  useEffect(() => {
    let raf
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const ctx  = audioManager.getContext()
      const now  = ctx ? ctx.currentTime : 0
      const mBpm = masterBpmRef.current

      // Deck A canvas
      if (canvasA.current) {
        if (canvasA.current.offsetWidth !== canvasA.current.width)
          canvasA.current.width = canvasA.current.offsetWidth
        const dA = deckA.current
        const pos = dA.track ? now - dA.startCtxTime + (dA.track.gridOffsetSec || 0) : 0
        drawDeck(canvasA.current, peaksARef.current, dA.track, mBpm, pos, pxPerSec, crossfading, loadingPA)
        if (dA.track) {
          const bd  = dA.track.barDurationSec
          const bts = Math.max(0, pos - (dA.track.gridOffsetSec || 0))
          setDeckABar(`${Math.floor(bts / bd) + 1}.${Math.floor((bts % bd) / (bd / 4)) + 1}`)
        }
      }

      // Deck B canvas
      if (canvasB.current) {
        if (canvasB.current.offsetWidth !== canvasB.current.width)
          canvasB.current.width = canvasB.current.offsetWidth
        const dB = deckB.current
        const pos = dB.track ? now - dB.startCtxTime + (dB.track.gridOffsetSec || 0) : 0
        drawDeck(canvasB.current, peaksBRef.current, dB.track, mBpm, pos, pxPerSec, crossfading, loadingPB)
        if (dB.track) {
          const bd  = dB.track.barDurationSec
          const bts = Math.max(0, pos - (dB.track.gridOffsetSec || 0))
          setDeckBBar(`${Math.floor(bts / bd) + 1}.${Math.floor((bts % bd) / (bd / 4)) + 1}`)
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pxPerSec, crossfading, loadingPA, loadingPB])

  // ── Fetch waveform peaks for display ─────────────────────────────────────
  async function fetchPeaks(track, deckId) {
    const setLoading = deckId === 'A' ? setLPA : setLPB
    const setPeaks   = deckId === 'A' ? setPeaksA : setPeaksB
    setLoading(true)
    try {
      const buffer = await audioManager.fetchDecode(track.url)
      setPeaks(buildPeaks(buffer))
    } catch (e) {
      console.warn('peaks failed', e)
    } finally {
      setLoading(false)
    }
  }

  // ── Play a track on a deck ────────────────────────────────────────────────
  // Returns { source, startCtxTime } via audioManager.playBufferDirect
  async function playTrack(track, deckRef, deckId, when) {
    const buffer = await audioManager.fetchDecode(track.url)

    // Stop previous source on this deck
    const prev = deckRef.current
    if (prev.source) { try { prev.source.stop() } catch {} }
    if (prev.gain)   { prev.gain.disconnect() }

    const gain = audioManager.createDeckGain()
    gain.gain.value = 1.0

    const masterBpm = masterBpmRef.current || track.bpm
    const rate = masterBpm / track.bpm

    const result = audioManager.playBufferDirect(
      buffer, gain,
      when,
      track.gridOffsetSec || 0,
      rate
    )

    deckRef.current = {
      track,
      startCtxTime: result.startTime - (track.gridOffsetSec || 0),
      gain,
      source: result.source,
    }

    // Fetch peaks async (display only)
    fetchPeaks(track, deckId)

    return result
  }

  // ── AUTO MIX loop ─────────────────────────────────────────────────────────
  async function startAutoMix() {
    if (running) return
    runRef.current = true
    setRunning(true)

    try {
      await audioManager.initialize()
      const ctx = audioManager.getContext()

      // Get shuffled playlist
      const tracks = [...playlist].sort(() => Math.random() - 0.5)
      if (tracks.length === 0) { setStatus('No tracks in playlist'); return }

      let idx = 0

      // First track — Deck A
      const first = tracks[idx++ % tracks.length]
      audioManager.setMasterBpm(first.bpm)
      setMasterBpm(first.bpm)
      masterBpmRef.current = first.bpm

      setStatus(`Loading: ${first.name}`)
      await playTrack(first, deckA, 'A', ctx.currentTime + 0.1)
      setStatus(`▶ DECK A — ${first.name.replace('.wav','').slice(0, 48)}`)

      // Main mix loop
      while (runRef.current) {
        const active = deckA.current.track ? deckA : deckB
        const incoming = deckA.current.track ? deckB : deckA
        const incomingId = deckA.current.track ? 'B' : 'A'
        const track = active.current.track

        if (!track) break

        const barDur = track.barDurationSec
        const xfadeDur = BARS_XFADE * barDur

        // Wait until BARS_PLAY bars have played from bar 1
        const xfadeStart = active.current.startCtxTime + (track.gridOffsetSec || 0) + BARS_PLAY * barDur
        await audioManager.waitUntil(xfadeStart)
        if (!runRef.current) break

        // Load next track
        const next = tracks[idx++ % tracks.length]
        setStatus(`Loading next: ${next.name.replace('.wav','').slice(0, 40)}`)

        let nextBuffer
        try {
          nextBuffer = await audioManager.fetchDecode(next.url)
        } catch (e) {
          setStatus(`Failed to load: ${next.name} — skipping`)
          continue
        }

        // Schedule incoming deck to start at bar boundary
        const nextBpm  = masterBpmRef.current || next.bpm
        const rate     = nextBpm / next.bpm
        const startAt  = xfadeStart  // start incoming right when we begin xfade

        setStatus(`⟶ XFADE → ${next.name.replace('.wav','').slice(0, 40)}`)

        // Stop previous on incoming deck, play new
        const prevIn = incoming.current
        if (prevIn.source) { try { prevIn.source.stop() } catch {} }
        if (prevIn.gain)   { prevIn.gain.disconnect() }

        const gainIn = audioManager.createDeckGain()
        gainIn.gain.value = 0  // start silent

        const buf2 = nextBuffer
        const src2 = audioManager.playBufferDirect(buf2, gainIn, startAt, next.gridOffsetSec || 0, rate)

        incoming.current = {
          track: next,
          startCtxTime: src2.startTime - (next.gridOffsetSec || 0),
          gain: gainIn,
          source: src2.source,
        }

        fetchPeaks(next, incomingId)

        // Crossfade: ramp active gain down, incoming gain up over xfadeDur
        const activeGain   = active.current.gain
        const incomingGain = gainIn
        const now = ctx.currentTime

        activeGain.gain.setValueAtTime(1.0, now)
        activeGain.gain.linearRampToValueAtTime(0.0, now + xfadeDur)
        incomingGain.gain.setValueAtTime(0.0, now)
        incomingGain.gain.linearRampToValueAtTime(1.0, now + xfadeDur)

        setCrossfading(true)

        // Animate crossfade progress
        const xfadeEnd = now + xfadeDur
        const animXf = () => {
          const pct = Math.min(1, (ctx.currentTime - now) / xfadeDur)
          setXfPct(Math.round(pct * 100))
          if (pct < 1) requestAnimationFrame(animXf)
          else { setCrossfading(false); setXfPct(0) }
        }
        requestAnimationFrame(animXf)

        // Clear the outgoing deck after xfade completes
        const outgoing = active
        setTimeout(() => {
          if (outgoing.current.source) { try { outgoing.current.source.stop() } catch {} }
          if (outgoing.current.gain)   { outgoing.current.gain.disconnect() }
          outgoing.current = { track: null, startCtxTime: 0, gain: null, source: null }
        }, xfadeDur * 1000 + 100)

        // Wait for xfade to finish, then loop
        await audioManager.waitUntil(xfadeEnd)
        setStatus(`▶ DECK ${incomingId} — ${next.name.replace('.wav','').slice(0, 48)}`)
      }
    } catch (e) {
      console.error('[GridTool] autoMix error:', e)
      setStatus('Error: ' + e.message)
    } finally {
      runRef.current = false
      setRunning(false)
    }
  }

  function stopAll() {
    runRef.current = false
    setRunning(false)
    setCrossfading(false)
    setXfPct(0)
    ;[deckA, deckB].forEach(d => {
      if (d.current.source) { try { d.current.source.stop() } catch {} }
      if (d.current.gain)   { d.current.gain.disconnect() }
      d.current = { track: null, startCtxTime: 0, gain: null, source: null }
    })
    setPeaksA(null); setPeaksB(null)
    setDeckABar(null); setDeckBBar(null)
    setMasterBpm(null)
    setStatus('Stopped')
  }

  useEffect(() => () => stopAll(), [])

  const GENRE_SLUGS = Object.keys(GENRE_FOLDER)

  return (
    <div style={{ position:'fixed', inset:0, background:'#060606', zIndex:9999,
      display:'flex', flexDirection:'column', fontFamily:'monospace', color:'#ccc' }}>

      {/* Top bar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px',
        background:'#0a0a0a', borderBottom:'1px solid #181818', flexWrap:'wrap' }}>

        <span style={{ color:'#fff', fontWeight:'bold', fontSize:14, letterSpacing:2 }}>GRID</span>

        <select value={genre} onChange={e => setGenre(e.target.value)} disabled={running}
          style={{ background:'#111', color:'#d4a64f', border:'1px solid #2a2a2a',
            padding:'4px 8px', borderRadius:3, fontFamily:'monospace', fontSize:12 }}>
          {GENRE_SLUGS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>

        {running
          ? <Btn red onClick={stopAll}>■ STOP</Btn>
          : <Btn gold onClick={startAutoMix}>▶ AUTO MIX</Btn>}

        {masterBpm && (
          <span style={{ fontSize:22, fontWeight:'bold', color:'#fff', letterSpacing:1 }}>
            {masterBpm.toFixed(1)}
            <span style={{ fontSize:10, color:'#444', marginLeft:4 }}>BPM</span>
          </span>
        )}

        {crossfading && (
          <span style={{ fontSize:11, color:'#d4a64f' }}>⟶ XFADE {xfPct}%</span>
        )}

        <div style={{ display:'flex', gap:3, marginLeft:'auto' }}>
          <Btn onClick={() => setPxPerSec(p => Math.min(p * 1.5, 2400))}>＋</Btn>
          <Btn onClick={() => setPxPerSec(p => Math.max(p / 1.5, 24))}>－</Btn>
          <Btn onClick={onClose}>✕</Btn>
        </div>

        <div style={{ width:'100%', fontSize:11, color:'#444', marginTop:1 }}>{status}</div>
      </div>

      {/* Deck A */}
      <DeckStrip id="A" barBeat={deckABar}
        track={deckA.current.track}
        active={!!deckA.current.track}
        crossfading={crossfading}
        canvasRef={canvasA} />

      {/* Deck B */}
      <DeckStrip id="B" barBeat={deckBBar}
        track={deckB.current.track}
        active={!!deckB.current.track}
        crossfading={crossfading}
        canvasRef={canvasB} />

      {/* Playlist */}
      <div style={{ flex:1, overflowY:'auto', padding:'6px 10px', borderTop:'1px solid #141414' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:2 }}>
          {playlist.map(t => {
            const isA = deckA.current.track?.name === t.name
            const isB = deckB.current.track?.name === t.name
            const nm  = t.name.replace('.wav','').replace(/^\d+[A-Za-z#]+\s*[-–]\s*/,'').slice(0, 50)
            return (
              <div key={t.name} style={{
                padding:'3px 7px', fontSize:10, borderRadius:2, display:'flex', gap:5, alignItems:'center',
                background: isA ? '#081508' : isB ? '#080813' : '#0d0d0d',
                border:`1px solid ${isA ? '#0a0' : isB ? '#33f' : '#181818'}`,
                color: t.confirmed ? '#8a8' : '#666'
              }}>
                <span style={{ width:8, flexShrink:0 }}>{t.confirmed ? '✓' : ''}</span>
                <span style={{ flex:1, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{nm}</span>
                <span style={{ color:'#333', flexShrink:0 }}>{t.bpm?.toFixed(1)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function DeckStrip({ id, barBeat, track, active, crossfading, canvasRef }) {
  const col  = id === 'A' ? '#0f0' : '#44f'
  const name = track ? track.name.replace('.wav','').replace(/^\d+[A-Za-z#]+\s*[-–]\s*/,'').slice(0, 52) : null
  return (
    <div style={{ padding:'4px 10px 2px', borderBottom:'1px solid #141414' }}>
      <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:2 }}>
        <span style={{ color: active ? col : '#222', fontWeight:'bold', fontSize:11,
          textShadow: active ? `0 0 6px ${col}` : 'none' }}>
          DECK {id}
        </span>
        {name
          ? <span style={{ color: crossfading ? '#d4a64f' : '#aaa', fontSize:11, flex:1,
              overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{name}</span>
          : <span style={{ color:'#222', fontSize:11 }}>—</span>}
        {barBeat && active &&
          <span style={{ color:'#d4a64f', fontSize:16, fontWeight:'bold', letterSpacing:1 }}>
            {barBeat}
          </span>}
      </div>
      <canvas ref={canvasRef} height={90}
        style={{ width:'100%', display:'block', background:'#060606' }} />
    </div>
  )
}

function Btn({ onClick, children, gold, red, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding:'5px 11px', fontSize:12,
      fontFamily:'monospace', fontWeight:'bold',
      background: red ? '#1a0505' : gold ? '#d4a64f' : '#141414',
      color: red ? '#f55' : gold ? '#000' : '#aaa',
      border:`1px solid ${red ? '#633' : gold ? '#a07830' : '#252525'}`,
      borderRadius:3, cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.4 : 1
    }}>
      {children}
    </button>
  )
}
