import React, { useState, useEffect, useRef } from 'react'
import audioManager from '../audio/audioManager'

// ─── Config ──────────────────────────────────────────────────────────────────
const BARS_PLAY  = 32   // play this many bars before crossfade
const BARS_XFADE = 8    // crossfade length in bars
const DSP_PORT   = 3800 // DSPEngine HTTP server
const DSP_BASE   = `http://localhost:${DSP_PORT}`

// Genre slug → AUTOSYNCED folder name
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

// ─── Overview: full track compressed, entire grid visible ────────────────────
function drawOverview(canvas, peaks, track, masterBpm, currentPos) {
  if (!canvas || !peaks || !track) return
  const W = canvas.width || canvas.offsetWidth || 800
  const H = canvas.height || 36
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#050505'
  ctx.fillRect(0, 0, W, H)

  const { max, min, BS, SR } = peaks
  const totalSec  = (max.length * BS) / SR
  const secPerPx  = totalSec / W

  // Beat grid first (behind waveform) — use real downbeat positions if available
  const downbeats = track.downbeats || []
  const useRealGrid = downbeats.length > 0
  
  if (useRealGrid) {
    // Use real downbeat positions from C++ analysis
    for (let b = 0; b < downbeats.length; b++) {
      const t = downbeats[b]
      const px = Math.round(t / secPerPx)
      if (px < 0 || px > W) continue
      const barNum = b + 1
      ctx.strokeStyle = barNum === 1 ? '#ff3300' : barNum % 8 === 1 ? '#550000' : '#2a0000'
      ctx.lineWidth   = barNum === 1 ? 2 : 1
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke()
    }
  } else {
    // Fallback to BPM calculation
    const bpm    = masterBpm || track.bpm
    const barDur = (60 / bpm) * 4
    const bar1   = track.gridOffsetSec || 0
    const nBars  = Math.ceil((totalSec - bar1) / barDur) + 2

    for (let b = -1; b <= nBars; b++) {
      const t      = bar1 + b * barDur
      const px     = Math.round(t / secPerPx)
      if (px < 0 || px > W) continue
      const barNum = b + 1
      ctx.strokeStyle = barNum === 1 ? '#ff3300' : barNum % 8 === 1 ? '#550000' : '#2a0000'
      ctx.lineWidth   = barNum === 1 ? 2 : 1
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke()
    }
  }

  // Waveform — peaks near a bar line pulse red, rest stay dark
  const bpm = masterBpm || track.bpm
  const barDur = (60 / bpm) * 4
  const bar1 = track.gridOffsetSec || 0
  
  for (let px = 0; px < W; px++) {
    const sec    = px * secPerPx
    const blockI = Math.floor(sec * SR / BS)
    if (blockI < 0 || blockI >= max.length) continue
    let mx = max[blockI], mn = min[blockI]
    const endBlock = Math.min(max.length - 1, Math.floor((px + 1) * secPerPx * SR / BS))
    for (let bi = blockI; bi <= endBlock; bi++) {
      if (max[bi] > mx) mx = max[bi]
      if (min[bi] < mn) mn = min[bi]
    }
    const y1 = H / 2 - mx * (H / 2) * 0.9
    const y2 = H / 2 - mn * (H / 2) * 0.9
    
    // Is this pixel near a bar line? Check against real grid or fallback to BPM calc
    let nearBar = false
    if (useRealGrid) {
      // Find nearest downbeat
      const threshold = barDur * 0.06
      nearBar = downbeats.some(db => Math.abs(sec - db) < threshold)
    } else {
      const distToBar = ((sec - bar1) % barDur + barDur) % barDur
      nearBar = Math.min(distToBar, barDur - distToBar) < barDur * 0.06
    }
    
    ctx.fillStyle = nearBar ? '#cc2200' : '#1a1a1a'
    ctx.fillRect(px, y1, 1, Math.max(1, y2 - y1))
  }

  // Playhead
  const playPx = Math.round(currentPos / secPerPx)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth   = 1
  ctx.beginPath(); ctx.moveTo(playPx, 0); ctx.lineTo(playPx, H); ctx.stroke()
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
  const downbeats = track.downbeats || []
  const useRealGrid = downbeats.length > 0

  // Grid lines drawn FIRST (behind waveform) — use real downbeat positions if available
  if (useRealGrid) {
    // Draw grid from real downbeat positions
    for (let b = 0; b < downbeats.length; b++) {
      const barTime = downbeats[b]
      const px = Math.round((barTime - currentPos) * pxPerSec + W / 2)
      if (px < -2 || px > W + 2) continue
      
      const barNum = b + 1
      if (barNum === 1) {
        ctx.strokeStyle = '#ff3300'; ctx.lineWidth = 3
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke()
        ctx.fillStyle = '#ff3300'; ctx.font = 'bold 11px monospace'
        ctx.fillText('1', px + 3, 12)
      } else {
        const bright = barNum % 8 === 1
        ctx.strokeStyle = bright ? '#660000' : '#330000'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke()
        if (bright && barNum > 1 && px > 4 && px < W - 20) {
          ctx.fillStyle = '#550000'; ctx.font = '9px monospace'
          ctx.fillText(barNum, px + 2, H - 3)
        }
      }
      
      // Draw beat subdivisions (4 beats per bar)
      if (b + 1 < downbeats.length) {
        const nextBarTime = downbeats[b + 1]
        const barDuration = nextBarTime - barTime
        const beatDuration = barDuration / 4
        for (let beat = 1; beat < 4; beat++) {
          const beatTime = barTime + beat * beatDuration
          const beatPx = Math.round((beatTime - currentPos) * pxPerSec + W / 2)
          if (beatPx >= 0 && beatPx <= W) {
            ctx.strokeStyle = '#220000'; ctx.lineWidth = 1
            ctx.beginPath(); ctx.moveTo(beatPx, H * 0.55); ctx.lineTo(beatPx, H); ctx.stroke()
          }
        }
      }
    }
  } else {
    // Fallback to BPM calculation
    const secStart   = currentPos - (W / 2) / pxPerSec - beatDur
    const firstBeat  = Math.floor((secStart - bar1rt) / beatDur) - 1
    const totalBeats = Math.ceil(W / pxPerSec / beatDur) + 4

    for (let b = firstBeat; b <= firstBeat + totalBeats; b++) {
      const t  = bar1rt + b * beatDur
      const px = Math.round((t - currentPos) * pxPerSec + W / 2)
      if (px < -2 || px > W + 2) continue
      const isBar  = b % 4 === 0
      const barNum = Math.floor(b / 4) + 1
      if (isBar) {
        if (barNum === 1 && b >= 0) {
          ctx.strokeStyle = '#ff3300'; ctx.lineWidth = 3
          ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke()
          ctx.fillStyle = '#ff3300'; ctx.font = 'bold 11px monospace'
          ctx.fillText('1', px + 3, 12)
        } else {
          const bright = barNum % 8 === 1
          ctx.strokeStyle = bright ? '#660000' : '#330000'; ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke()
          if (bright && barNum > 1 && px > 4 && px < W - 20) {
            ctx.fillStyle = '#550000'; ctx.font = '9px monospace'
            ctx.fillText(barNum, px + 2, H - 3)
          }
        }
      } else {
        ctx.strokeStyle = '#220000'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(px, H * 0.55); ctx.lineTo(px, H); ctx.stroke()
      }
    }
  }

  // Waveform on top — peaks that land on a bar line pulse bright red
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
      
      // Color: red if near a bar line, check against real grid or fallback to BPM calc
      let nearBar = false, nearBeat = false
      if (useRealGrid) {
        // Check against real downbeat positions
        const barThreshold = beatDur * 0.15
        const beatThreshold = beatDur * 0.12
        nearBar = downbeats.some(db => Math.abs(sec - db) < barThreshold)
        // For beats, estimate from bar positions
        for (let b = 0; b < downbeats.length - 1; b++) {
          const barTime = downbeats[b]
          const nextBarTime = downbeats[b + 1]
          const barDuration = nextBarTime - barTime
          const beatDuration = barDuration / 4
          for (let beat = 0; beat < 4; beat++) {
            const beatTime = barTime + beat * beatDuration
            if (Math.abs(sec - beatTime) < beatThreshold) {
              nearBeat = true
              break
            }
          }
          if (nearBeat) break
        }
      } else {
        const distToBar = ((sec - bar1rt) % barDur + barDur) % barDur
        nearBar = Math.min(distToBar, barDur - distToBar) < beatDur * 0.15
        nearBeat = Math.min(((sec - bar1rt) % beatDur + beatDur) % beatDur, beatDur) < beatDur * 0.12
      }
      
      ctx.fillStyle = nearBar ? '#ff4400' : nearBeat ? '#441100' : crossfading ? '#2a0800' : '#111'
      ctx.fillRect(px, y1, 1, y2 - y1 + 1)
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

  // Per-deck volume faders (0–1)
  const [volA, setVolA] = useState(1)
  const [volB, setVolB] = useState(1)

  // Track picker: which deck is waiting for a track to be loaded
  const [pickingDeck, setPickingDeck] = useState(null)  // 'A' | 'B' | null

  const canvasA  = useRef(null)
  const canvasB  = useRef(null)
  const overviewA = useRef(null)
  const overviewB = useRef(null)
  const runRef   = useRef(false)

  // Drag-to-scrub on main waveform (when stopped)
  const dragRef = useRef({ active: false, deck: null, startX: 0, startPos: 0 })

  // Deck state refs (updated by auto-mix loop, read by rAF)
  // frozenPos: when stopped, waveform stays visible at this file position
  const deckA = useRef({ track: null, startCtxTime: 0, gain: null, source: null, frozenPos: 0 })
  const deckB = useRef({ track: null, startCtxTime: 0, gain: null, source: null, frozenPos: 0 })

  const masterBpmRef = useRef(null)
  const peaksARef    = useRef(null)
  const peaksBRef    = useRef(null)
  useEffect(() => { masterBpmRef.current = masterBpm },  [masterBpm])
  useEffect(() => { peaksARef.current   = peaksA },      [peaksA])
  useEffect(() => { peaksBRef.current   = peaksB },      [peaksB])

  // Load playlist when genre changes — fetch from 3800 DSP engine
  useEffect(() => {
    setPlaylist([])
    const folderName = GENRE_FOLDER[genre] || 'Tech House'
    fetch(`${DSP_BASE}/tracks?folder=${encodeURIComponent(folderName)}`)
      .then(r => r.json())
      .then(data => {
        // Transform DSP engine format to GridTool format
        const tracks = data.tracks.map(t => ({
          name: t.filename,
          bpm: t.bpm,
          key: t.key,
          gridOffsetSec: t.firstDownbeatSec,
          barDurationSec: (60 / t.bpm) * 4,
          downbeats: t.downbeats || []  // Real downbeat positions from C++ analysis
        }))
        setPlaylist(tracks)
      })
      .catch(() => setStatus('DSP engine not running on :3800'))
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
        // If source is playing, track pos in real time; otherwise freeze at last position
        let pos = dA.frozenPos || 0
        if (dA.track && dA.source) {
          pos = now - dA.startCtxTime + (dA.track.gridOffsetSec || 0)
          dA.frozenPos = pos
        }
        drawDeck(canvasA.current, peaksARef.current, dA.track, mBpm, pos, pxPerSec, crossfading, loadingPA)
        if (overviewA.current) {
          if (overviewA.current.offsetWidth !== overviewA.current.width)
            overviewA.current.width = overviewA.current.offsetWidth
          drawOverview(overviewA.current, peaksARef.current, dA.track, mBpm, pos)
        }
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
        let pos = dB.frozenPos || 0
        if (dB.track && dB.source) {
          pos = now - dB.startCtxTime + (dB.track.gridOffsetSec || 0)
          dB.frozenPos = pos
        }
        drawDeck(canvasB.current, peaksBRef.current, dB.track, mBpm, pos, pxPerSec, crossfading, loadingPB)
        if (overviewB.current) {
          if (overviewB.current.offsetWidth !== overviewB.current.width)
            overviewB.current.width = overviewB.current.offsetWidth
          drawOverview(overviewB.current, peaksBRef.current, dB.track, mBpm, pos)
        }
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

  // ── Drag waveform to scrub (when stopped) ───────────────────────────────
  function onDragStart(e, deckRef) {
    if (deckRef.current.source) return   // let click-to-seek handle live
    dragRef.current = { active: true, deckRef, startX: e.clientX, startPos: deckRef.current.frozenPos || 0 }
  }
  function onDragMove(e) {
    const d = dragRef.current
    if (!d.active) return
    const dx  = e.clientX - d.startX
    const sec = dx / pxPerSec
    d.deckRef.current.frozenPos = Math.max(0, d.startPos - sec)
  }
  function onDragEnd() { dragRef.current.active = false }

  // ── Click overview → jump main view to that position ────────────────────
  function onOverviewClick(e, deckRef, peaksRef) {
    const p = peaksRef.current; const d = deckRef.current
    if (!p || !d.track) return
    const rect     = e.currentTarget.getBoundingClientRect()
    const xPct     = (e.clientX - rect.left) / rect.width
    const totalSec = (p.max.length * p.BS) / p.SR
    const seekPos  = xPct * totalSec
    d.frozenPos = seekPos
    // If playing, restart from here
    if (d.source) {
      try { d.source.stop() } catch {}
      audioManager.fetchDecode(d.track.url).then(buf => {
        const ctx  = audioManager.getContext()
        const rate = (masterBpmRef.current || d.track.bpm) / d.track.bpm
        const res  = audioManager.playBufferDirect(buf, d.gain, ctx.currentTime + 0.05, seekPos, rate)
        deckRef.current = { ...d, source: res.source, startCtxTime: res.startTime - seekPos }
      })
    }
  }

  // ── Click waveform → seek to that position ───────────────────────────────
  function onCanvasClick(e, deckRef, deckId) {
    const d = deckRef.current
    if (!d.track || !d.source) return
    const canvas = e.currentTarget
    const rect   = canvas.getBoundingClientRect()
    const xPct   = (e.clientX - rect.left) / rect.width
    // Center of canvas = current position; left/right = earlier/later
    const ctx    = audioManager.getContext()
    const now    = ctx.currentTime
    const curPos = now - d.startCtxTime + (d.track.gridOffsetSec || 0)
    const halfW  = rect.width / 2
    const clickOffset = (e.clientX - rect.left - halfW) / pxPerSec
    const newPos = Math.max(0, curPos + clickOffset)
    // Restart source at new position
    try { d.source.stop() } catch {}
    if (d.gain) {
      const rate = (masterBpmRef.current || d.track.bpm) / d.track.bpm
      const res  = audioManager.playBufferDirect(
        audioManager.decodedBuffers[d.track.url], d.gain,
        ctx.currentTime + 0.03, newPos, rate
      )
      deckRef.current = { ...d, source: res.source, startCtxTime: res.startTime - newPos }
    }
  }

  // ── Nudge grid offset ±1 beat, or set bar 1 to current position ──────────
  async function nudgeGrid(deckRef, deckId, beats) {
    const d = deckRef.current
    if (!d.track) return
    const beatSec = 60 / d.track.bpm
    const newOff  = Math.max(0, (d.track.gridOffsetSec || 0) + beats * beatSec)
    await saveGridOffset(deckRef, deckId, newOff)
  }

  async function setBar1Here(deckRef, deckId) {
    const d = deckRef.current
    if (!d.track) return
    // Use frozen position when stopped, live position when playing
    let pos = d.frozenPos || 0
    if (d.source) {
      const ctx = audioManager.getContext()
      pos = ctx.currentTime - d.startCtxTime + (d.track.gridOffsetSec || 0)
    }
    const beatSec = 60 / d.track.bpm
    const snapped = Math.round(pos / beatSec) * beatSec
    await saveGridOffset(deckRef, deckId, Math.max(0, snapped))
  }

  async function saveGridOffset(deckRef, deckId, newOff) {
    const d = deckRef.current
    if (!d.track) return
    d.track.gridOffsetSec  = newOff
    d.track.barDurationSec = (60 / d.track.bpm) * 4
    // Note: Grid offset changes would require re-running C++ analysis
    // For now, just update local state (DSP engine doesn't have a setgrid endpoint)
    setStatus(`Grid offset → ${newOff.toFixed(4)}s (local only — re-analyze to persist)`)
    // Force canvas redraw by tickling state
    if (deckId === 'A') setPeaksA(p => p ? { ...p } : null)
    else setPeaksB(p => p ? { ...p } : null)
  }

  // ── Play a track on a deck ────────────────────────────────────────────────
  // Returns { source, startCtxTime } via audioManager.playBufferDirect
  async function playTrack(track, deckRef, deckId, scheduledWhen) {
    const buffer = await audioManager.fetchDecode(track.url)

    // Re-compute when AFTER decode — the fetch can take seconds
    const ctx    = audioManager.getContext()
    const when   = Math.max(scheduledWhen ?? 0, ctx.currentTime + 0.05)

    // Stop previous source on this deck
    const prev = deckRef.current
    if (prev.source) { try { prev.source.stop() } catch {} }
    if (prev.gain)   { prev.gain.disconnect() }

    const gain = audioManager.createDeckGain()
    gain.gain.value = 1.0

    const masterBpm = masterBpmRef.current || track.bpm
    const rate      = masterBpm / track.bpm
    const offset    = track.gridOffsetSec || 0

    const result = audioManager.playBufferDirect(buffer, gain, when, offset, rate)

    // startCtxTime = ctx time at which file position 0 would be
    // (source starts at `when` playing from `offset`, so pos-0 was at `when - offset`)
    deckRef.current = {
      track,
      startCtxTime: result.startTime - offset,
      gain,
      source: result.source,
    }

    fetchPeaks(track, deckId)
    return result
  }

  // ── Load a track onto a deck (no playback — just waveform + grid) ────────
  async function loadTrack(track, deckRef, deckId) {
    const prev = deckRef.current
    if (prev.source) { try { prev.source.stop() } catch {} }
    if (prev.gain)   { prev.gain.disconnect() }
    const bar1 = track.gridOffsetSec || 0
    // Park waveform at bar 1 so grid is centered on the downbeat immediately
    deckRef.current = { track, startCtxTime: 0, gain: null, source: null, frozenPos: bar1 }
    setPickingDeck(null)
    setStatus(`Loaded Deck ${deckId}: ${track.name.replace('.wav','').slice(0,48)} — bar1@${bar1.toFixed(3)}s`)
    fetchPeaks(track, deckId)
    if (!masterBpmRef.current) {
      setMasterBpm(track.bpm)
      masterBpmRef.current = track.bpm
    }
  }

  // ── Play a loaded deck — ALWAYS starts from bar 1 (gridOffsetSec) ────────
  async function playDeckManual(deckRef, deckId) {
    const d = deckRef.current
    if (!d.track) { setStatus(`Nothing loaded on deck ${deckId}`); return }
    await audioManager.initialize()
    const ctx  = audioManager.getContext()
    if (d.source) { try { d.source.stop() } catch {} }
    if (d.gain)   { d.gain.disconnect() }
    const gain   = audioManager.createDeckGain()
    gain.gain.value = deckId === 'A' ? volA : volB
    const buffer = await audioManager.fetchDecode(d.track.url)
    const offset = d.track.gridOffsetSec || 0   // always bar 1
    const rate   = (masterBpmRef.current || d.track.bpm) / d.track.bpm
    const result = audioManager.playBufferDirect(buffer, gain, ctx.currentTime + 0.05, offset, rate)
    deckRef.current = { ...d, gain, source: result.source, startCtxTime: result.startTime - offset }
    setStatus(`▶ Deck ${deckId} — bar 1 @ ${offset.toFixed(3)}s`)
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

      // Pre-fetch the second track while first is loading
      let nextIdx       = idx % tracks.length
      idx++
      let nextTrack     = tracks[nextIdx]
      let nextBufPromise = audioManager.fetchDecode(nextTrack.url).catch(() => null)

      // Main mix loop
      while (runRef.current) {
        const active      = deckA.current.track ? deckA : deckB
        const incoming    = deckA.current.track ? deckB  : deckA
        const incomingId  = deckA.current.track ? 'B'    : 'A'
        const track       = active.current.track
        if (!track) break

        const barDur   = track.barDurationSec
        const xfadeDur = BARS_XFADE * barDur

        // xfadeStart = ctx time when bar BARS_PLAY starts
        const xfadeStart = active.current.startCtxTime + (track.gridOffsetSec || 0) + BARS_PLAY * barDur

        // Wait halfway (BARS_PLAY/2) then kick off next prefetch if not done
        const halfPoint = active.current.startCtxTime + (track.gridOffsetSec || 0) + (BARS_PLAY / 2) * barDur
        await audioManager.waitUntil(halfPoint)
        if (!runRef.current) break
        setStatus(`Next up: ${nextTrack.name.replace('.wav','').slice(0,38)}…`)

        // Wait for xfade bar — next track buffer should be decoded by now
        await audioManager.waitUntil(xfadeStart)
        if (!runRef.current) break

        const nextBuffer = await nextBufPromise
        if (!nextBuffer) {
          // Track failed — skip to one after
          nextIdx    = idx % tracks.length; idx++
          nextTrack  = tracks[nextIdx]
          nextBufPromise = audioManager.fetchDecode(nextTrack.url).catch(() => null)
          continue
        }

        // Schedule incoming track to start exactly at xfadeStart
        const rate   = (masterBpmRef.current || nextTrack.bpm) / nextTrack.bpm
        const offset = nextTrack.gridOffsetSec || 0
        const prevIn = incoming.current
        if (prevIn.source) { try { prevIn.source.stop() } catch {} }
        if (prevIn.gain)   { prevIn.gain.disconnect() }

        const gainIn = audioManager.createDeckGain()
        gainIn.gain.value = 0

        const src2 = audioManager.playBufferDirect(nextBuffer, gainIn, xfadeStart, offset, rate)
        incoming.current = {
          track: nextTrack,
          startCtxTime: src2.startTime - offset,
          gain: gainIn,
          source: src2.source,
        }
        fetchPeaks(nextTrack, incomingId)

        setStatus(`⟶ XFADE → ${nextTrack.name.replace('.wav','').slice(0, 42)}`)

        // Beat-accurate gain ramps using AudioParam automation
        const now        = ctx.currentTime
        const activeGain = active.current.gain
        activeGain.gain.setValueAtTime(1.0, now)
        activeGain.gain.linearRampToValueAtTime(0.0, now + xfadeDur)
        gainIn.gain.setValueAtTime(0.0, now)
        gainIn.gain.linearRampToValueAtTime(1.0, now + xfadeDur)
        setCrossfading(true)

        const xfadeEnd = now + xfadeDur
        const animXf = () => {
          const pct = Math.min(1, (ctx.currentTime - now) / xfadeDur)
          setXfPct(Math.round(pct * 100))
          if (pct < 1) requestAnimationFrame(animXf)
          else { setCrossfading(false); setXfPct(0) }
        }
        requestAnimationFrame(animXf)

        // Stop outgoing after xfade
        const outgoing = active
        setTimeout(() => {
          if (outgoing.current.source) { try { outgoing.current.source.stop() } catch {} }
          if (outgoing.current.gain)   { outgoing.current.gain.disconnect() }
          outgoing.current = { track: null, startCtxTime: 0, gain: null, source: null }
        }, xfadeDur * 1000 + 200)

        // Pre-fetch the NEXT next track while xfade plays
        nextIdx        = idx % tracks.length; idx++
        nextTrack      = tracks[nextIdx]
        nextBufPromise = audioManager.fetchDecode(nextTrack.url).catch(() => null)

        await audioManager.waitUntil(xfadeEnd)
        setStatus(`▶ DECK ${incomingId} — ${incoming.current.track?.name.replace('.wav','').slice(0, 48)}`)
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
      // Keep track + peaks so waveform stays visible for grid editing
      d.current = { ...d.current, source: null, gain: null }
    })
    setStatus('Stopped — adjust grid, then AUTO MIX again')
  }

  useEffect(() => () => stopAll(), [])

  const GENRE_SLUGS = Object.keys(GENRE_FOLDER)

  // ── Batch analyze all tracks in current genre ─────────────────────────
  async function analyzeAll() {
    setStatus(`Analysis runs on DSP engine startup — use audio-server.js to re-analyze`)
    // The 3800 DSP engine analyzes tracks on startup
    // For manual re-analysis, use audio-server.js on port 3003
    // This button is kept for UI consistency but doesn't trigger analysis
  }
  }

  return (
    <div
      style={{ position:'fixed', inset:0, background:'#060606', zIndex:9999,
        display:'flex', flexDirection:'column', fontFamily:'monospace', color:'#ccc' }}
      onMouseMove={onDragMove}
      onMouseUp={onDragEnd}
      onMouseLeave={onDragEnd}
    >
      {/* Top bar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px',
        background:'#0a0a0a', borderBottom:'1px solid #181818', flexWrap:'wrap' }}>

        <span style={{ color:'#fff', fontWeight:'bold', fontSize:14, letterSpacing:2 }}>GRID</span>

        <select value={genre} onChange={e => setGenre(e.target.value)} disabled={running}
          style={{ background:'#111', color:'#d4a64f', border:'1px solid #2a2a2a',
            padding:'3px 7px', borderRadius:3, fontFamily:'monospace', fontSize:11 }}>
          {GENRE_SLUGS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>

        {running
          ? <Btn red onClick={stopAll}>■ STOP</Btn>
          : <Btn gold onClick={startAutoMix}>▶ AUTO MIX</Btn>}

        {!running && <Btn onClick={analyzeAll}>⟳ ANALYZE ALL</Btn>}

        {masterBpm && (
          <span style={{ fontSize:20, fontWeight:'bold', color:'#fff', letterSpacing:1 }}>
            {masterBpm.toFixed(1)}<span style={{ fontSize:9, color:'#444', marginLeft:3 }}>BPM</span>
          </span>
        )}
        {crossfading && <span style={{ fontSize:11, color:'#d4a64f' }}>⟶ XFADE {xfPct}%</span>}

        <div style={{ display:'flex', gap:3, marginLeft:'auto' }}>
          <Btn onClick={() => setPxPerSec(p => Math.min(p * 1.5, 2400))}>＋</Btn>
          <Btn onClick={() => setPxPerSec(p => Math.max(p / 1.5, 24))}>－</Btn>
          <Btn onClick={onClose}>✕</Btn>
        </div>

        <div style={{ width:'100%', fontSize:10, color:'#444', marginTop:1 }}>{status}</div>
      </div>

      {/* ── Deck A ── */}
      <DeckStrip
        id="A" barBeat={deckABar} track={deckA.current.track}
        playing={!!deckA.current.source} crossfading={crossfading}
        vol={volA} onVol={v => { setVolA(v); if (deckA.current.gain) deckA.current.gain.gain.value = v }}
        canvasRef={canvasA} overviewRef={overviewA}
        onDragStart={e => onDragStart(e, deckA)}
        onCanvasClick={e => onCanvasClick(e, deckA, 'A')}
        onOverviewClick={e => onOverviewClick(e, deckA, peaksARef)}
        onNudge={b => nudgeGrid(deckA, 'A', b)}
        onSetBar1={() => setBar1Here(deckA, 'A')}
        onPlay={() => playDeckManual(deckA, 'A')}
        onStop={() => { if (deckA.current.source) { try { deckA.current.source.stop() } catch {} } deckA.current = { ...deckA.current, source: null, gain: null } }}
        onAdd={() => setPickingDeck(pickingDeck === 'A' ? null : 'A')}
        picking={pickingDeck === 'A'}
      />

      {/* ── Deck B ── */}
      <DeckStrip
        id="B" barBeat={deckBBar} track={deckB.current.track}
        playing={!!deckB.current.source} crossfading={crossfading}
        vol={volB} onVol={v => { setVolB(v); if (deckB.current.gain) deckB.current.gain.gain.value = v }}
        canvasRef={canvasB} overviewRef={overviewB}
        onDragStart={e => onDragStart(e, deckB)}
        onCanvasClick={e => onCanvasClick(e, deckB, 'B')}
        onOverviewClick={e => onOverviewClick(e, deckB, peaksBRef)}
        onNudge={b => nudgeGrid(deckB, 'B', b)}
        onSetBar1={() => setBar1Here(deckB, 'B')}
        onPlay={() => playDeckManual(deckB, 'B')}
        onStop={() => { if (deckB.current.source) { try { deckB.current.source.stop() } catch {} } deckB.current = { ...deckB.current, source: null, gain: null } }}
        onAdd={() => setPickingDeck(pickingDeck === 'B' ? null : 'B')}
        picking={pickingDeck === 'B'}
      />

      {/* ── Playlist ── */}
      <div style={{ flex:1, overflowY:'auto', padding:'5px 10px', borderTop:'1px solid #141414' }}>
        {pickingDeck && (
          <div style={{ padding:'4px 0 6px', fontSize:10, color:'#d4a64f' }}>
            ↓ Click a track to load onto Deck {pickingDeck}
          </div>
        )}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))', gap:2 }}>
          {playlist.map(t => {
            const isA = deckA.current.track?.name === t.name
            const isB = deckB.current.track?.name === t.name
            const nm  = t.name.replace('.wav','').replace(/^\d+[A-Za-z#]+\s*[-–]\s*/,'').slice(0, 50)
            return (
              <div key={t.name}
                onClick={() => {
                  if (pickingDeck === 'A') loadTrack(t, deckA, 'A')
                  else if (pickingDeck === 'B') loadTrack(t, deckB, 'B')
                }}
                style={{
                  padding:'3px 7px', fontSize:10, borderRadius:2,
                  display:'flex', gap:5, alignItems:'center',
                  background: isA ? '#081508' : isB ? '#080813' : '#0d0d0d',
                  border:`1px solid ${isA ? '#0a0' : isB ? '#33f' : pickingDeck ? '#2a2000' : '#181818'}`,
                  color: t.confirmed ? '#8a8' : '#666',
                  cursor: pickingDeck ? 'pointer' : 'default'
                }}>
                <span style={{ width:8, flexShrink:0 }}>{isA ? 'A' : isB ? 'B' : t.confirmed ? '✓' : ''}</span>
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

function DeckStrip({ id, barBeat, track, playing, crossfading, vol, onVol,
                     canvasRef, overviewRef, onDragStart, onCanvasClick, onOverviewClick,
                     onNudge, onSetBar1, onPlay, onStop, onAdd, picking }) {
  const col  = id === 'A' ? '#00dd44' : '#4466ff'
  const name = track ? track.name.replace('.wav','').replace(/^\d+[A-Za-z#]+\s*[-–]\s*/,'').slice(0, 52) : null

  return (
    <div style={{ borderBottom:'1px solid #141414' }}>

      {/* Header row */}
      <div style={{ display:'flex', alignItems:'center', gap:6, padding:'3px 10px' }}>
        <span style={{ color: track ? col : '#222', fontWeight:'bold', fontSize:11,
          textShadow: track ? `0 0 6px ${col}` : 'none', minWidth:52 }}>
          DECK {id}
        </span>

        {/* ADD button */}
        <button onClick={onAdd} style={{
          padding:'2px 9px', fontSize:10, fontFamily:'monospace', fontWeight:'bold',
          background: picking ? '#1a1000' : '#111', color: picking ? '#d4a64f' : '#555',
          border:`1px solid ${picking ? '#d4a64f' : '#2a2a2a'}`, borderRadius:3, cursor:'pointer'
        }}>+ ADD</button>

        {/* Track name */}
        {name
          ? <span style={{ color: crossfading ? '#d4a64f' : '#aaa', fontSize:10, flex:1,
              overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{name}</span>
          : <span style={{ color:'#1a1a1a', fontSize:10, flex:1 }}>— load a track —</span>}

        {/* Bar:beat counter */}
        {barBeat && playing &&
          <span style={{ color:'#d4a64f', fontSize:15, fontWeight:'bold', letterSpacing:1, minWidth:48 }}>
            {barBeat}
          </span>}

        {/* Play / Stop */}
        {track && (playing
          ? <Btn red onClick={onStop}>■</Btn>
          : <Btn onClick={onPlay}>▶</Btn>)}

        {/* Fader */}
        {track && (
          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ fontSize:9, color:'#333' }}>VOL</span>
            <input type="range" min="0" max="1" step="0.01" value={vol}
              onChange={e => onVol(parseFloat(e.target.value))}
              style={{ width:90, accentColor: col, cursor:'pointer' }} />
            <span style={{ fontSize:9, color:'#444', minWidth:24 }}>{Math.round(vol*100)}%</span>
          </div>
        )}

        {/* Grid nudge */}
        {track && <>
          <Btn onClick={() => onNudge(-1)}>◄</Btn>
          <Btn onClick={() => onNudge(1)}>►</Btn>
          <button onClick={onSetBar1} style={{
            padding:'3px 8px', fontSize:10, fontFamily:'monospace', fontWeight:'bold',
            background:'#1a1a00', color:'#ff0', border:'1px solid #444', borderRadius:3, cursor:'pointer'
          }}>↓1</button>
          <span style={{ fontSize:9, color:'#2a2a2a' }}>{track.gridOffsetSec?.toFixed(3)}s</span>
        </>}
      </div>

      {/* Main waveform — drag to scrub */}
      <canvas ref={canvasRef} height={80}
        onMouseDown={onDragStart}
        onClick={onCanvasClick}
        style={{ width:'100%', display:'block', background:'#060606',
          cursor: playing ? 'crosshair' : 'ew-resize' }} />

      {/* Full-track overview — see entire grid across whole song */}
      <canvas ref={overviewRef} height={34}
        onClick={onOverviewClick}
        style={{ width:'100%', display:'block', background:'#050505', cursor:'pointer',
          borderTop:'1px solid #0a0a0a' }} />
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
