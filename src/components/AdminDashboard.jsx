import React, { useState, useEffect, useRef, useCallback } from 'react'
import './AdminDashboard.css'

// 16 genre folders mapped to DSPEngine load path + display colors
const GENRE_STRIPS = [
  { slug: 'tech-house',           folder: 'Tech House',                color: '#ff6b35', short: 'TH' },
  { slug: 'house',                folder: 'House',                     color: '#f7c59f', short: 'HO' },
  { slug: 'afro-house',           folder: 'Afro House',                color: '#e76f51', short: 'AF' },
  { slug: 'deep-house',           folder: 'Deep House',                color: '#264653', short: 'DH' },
  { slug: 'deep-tech',            folder: 'Deep Tech',                 color: '#2a9d8f', short: 'DT' },
  { slug: 'disco',                folder: 'Disco',                     color: '#e9c46a', short: 'DI' },
  { slug: 'indie-dance',          folder: 'Indie Dance',               color: '#f4a261', short: 'ID' },
  { slug: 'jp-sets',              folder: 'JP Sets',                   color: '#d62828', short: 'JP' },
  { slug: 'jackin-house',         folder: 'Jackin House',              color: '#9b5de5', short: 'JH' },
  { slug: 'melodic-house',        folder: 'Melodic House & Techno',    color: '#00bbf9', short: 'MH' },
  { slug: 'minimal-deep-tech',    folder: 'Minimal Deep Tech',         color: '#00f5d4', short: 'MD' },
  { slug: 'nu-disco',             folder: 'Nu Disco Disco',            color: '#fee440', short: 'ND' },
  { slug: 'soul-funk-disco',      folder: 'Soul Funk Disco',           color: '#f15bb5', short: 'SF' },
  { slug: 'techno-peak',          folder: 'Techno (Peak Time Driving)', color: '#8d0801', short: 'TP' },
  { slug: 'techno-raw',           folder: 'Techno (Raw Deep Hypnotic)', color: '#3a0ca3', short: 'TR' },
  { slug: 'jp-classics',          folder: 'jp-classics',               color: '#7209b7', short: 'JC' },
]

const DSP_PORT = 3800
const DSP_BASE = `http://localhost:${DSP_PORT}`
const POLL_MS = 100

export default function AdminDashboard() {
  const [activeGenre, setActiveGenre] = useState(null)
  const [loadingGenre, setLoadingGenre] = useState(null)
  const [status, setStatus] = useState(null)
  const [tracks, setTracks] = useState([])
  const [trackAnalyses, setTrackAnalyses] = useState({})
  const pollRef = useRef(null)

  // Poll DSPEngine status
  useEffect(() => {
    const poll = async () => {
      try {
        const [statusRes, tracksRes] = await Promise.all([
          fetch(`${DSP_BASE}/status`),
          fetch(`${DSP_BASE}/tracks`)
        ])
        if (statusRes.ok) {
          const s = await statusRes.json()
          setStatus(s)
        }
        if (tracksRes.ok) {
          const t = await tracksRes.json()
          setTracks(t)
          // Cache analyses by (folder, title) for waveform rendering
          const analyses = {}
          for (const tr of t) {
            const title = tr.title || tr.file?.split('/').pop() || ''
            const folder = tr.file?.includes('/AUTOSYNCED/')
              ? tr.file.split('/AUTOSYNCED/')[1]?.split('/')[0]
              : ''
            if (folder && title) {
              analyses[`${folder}|${title}`] = tr
            }
          }
          setTrackAnalyses(prev => ({ ...prev, ...analyses }))
        }
      } catch (_) {}
    }
    poll()
    pollRef.current = setInterval(poll, POLL_MS)
    return () => clearInterval(pollRef.current)
  }, [])

  const loadAndPlay = useCallback(async (genre) => {
    setLoadingGenre(genre.slug)
    try {
      // Stop current playback
      await fetch(`${DSP_BASE}/stop`, { method: 'POST' })
      // Load the genre folder
      const fullPath = `/Users/jp/Desktop/AUTOSYNCED/${genre.folder}`
      const loadRes = await fetch(`${DSP_BASE}/load-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fullPath })
      })
      if (!loadRes.ok) {
        console.error('load failed', await loadRes.text())
        setLoadingGenre(null)
        return
      }
      await loadRes.json()
      // Wait a moment for tracks to load
      await new Promise(r => setTimeout(r, 1000))
      // Start playback (auto-seeks to firstDownbeatSec)
      const startRes = await fetch(`${DSP_BASE}/start`, { method: 'POST' })
      if (startRes.ok) {
        setActiveGenre(genre.slug)
        const pid = genre.slug
        console.log(`[ADMIN] now playing: ${genre.folder} (${pid})`)
      }
    } catch (e) {
      console.error('load/play error:', e)
    }
    setLoadingGenre(null)
  }, [])

  // Current playback position from status
  const posSec = status?.posSecA ?? status?.posSecB ?? 0
  const masterBpm = status?.masterBpm ?? 0
  const playing = status?.deckA || status?.deckB

  // Build a simple waveform placeholder using BPM and track count
  const trackCount = tracks.length

  return (
    <div className="admin-dashboard">
      <div className="admin-header">
        <div className="admin-title">🎛 SHADY RADIO — ADMIN</div>
        <div className="admin-status-bar">
          <span className={`status-dot ${playing ? 'green' : 'red'}`} />
          <span>{playing ? 'PLAYING' : 'STOPPED'}</span>
          {status?.deckABpm > 0 && (
            <span className="bpm-badge">
              {status.deckABpm.toFixed(1)}
              {status.crossfading && status.deckBBpm > 0 && ` → ${status.deckBBpm.toFixed(1)}`}
              {' BPM'}
            </span>
          )}
          <span className="track-count">{trackCount} tracks loaded</span>
          {activeGenre && <span className="active-genre-label">{GENRE_STRIPS.find(g => g.slug === activeGenre)?.folder}</span>}
        </div>
      </div>

      <div className="strips-container">
        {GENRE_STRIPS.map((genre) => (
          <GenreStrip
            key={genre.slug}
            genre={genre}
            isActive={activeGenre === genre.slug}
            isLoading={loadingGenre === genre.slug}
            status={status}
            tracks={tracks}
            trackAnalyses={trackAnalyses}
            onClick={() => loadAndPlay(genre)}
          />
        ))}
      </div>
    </div>
  )
}

function GenreStrip({ genre, isActive, isLoading, status, tracks, trackAnalyses, onClick }) {
  const canvasRef = useRef(null)
  const animRef = useRef(null)

  // Filter tracks that belong to this genre folder
  const genreTracks = tracks.filter(t => {
    const fp = t.file || ''
    return fp.includes(`/AUTOSYNCED/${genre.folder}/`) || fp.includes(`/AUTOSYNCED/${genre.folder}`)
  })

  const firstTrack = genreTracks[0]
  const bpm = firstTrack?.bpm || 0
  const key = firstTrack?.key || firstTrack?.camelot_key || ''
  const firstDbSec = firstTrack?.firstDownbeatSec || 0
  const downbeats = firstTrack?.downbeats || []

  // Draw waveform + beat grid on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width
    const H = canvas.height

    const draw = () => {
      ctx.clearRect(0, 0, W, H)

      // Background
      const bg = isActive ? 'rgba(212,166,79,0.08)' : 'rgba(255,255,255,0.03)'
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)

      if (genreTracks.length === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.15)'
        ctx.font = '12px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('empty', W/2, H/2 + 4)
        return
      }

      // Use real downbeat positions if available, otherwise fall back to BPM calculation
      const useRealGrid = downbeats && downbeats.length > 0
      const totalBars = useRealGrid ? Math.min(downbeats.length, 64) : 64
      const barDurSec = bpm > 0 ? (60.0 / bpm) * 4.0 : 1.0
      const totalDuration = useRealGrid 
        ? downbeats[totalBars - 1] 
        : barDurSec * totalBars

      // Draw beat grid
      if (bpm > 0 || useRealGrid) {
        for (let bar = 0; bar < totalBars; bar++) {
          // Calculate x position from real downbeat time or BPM
          const barTime = useRealGrid ? downbeats[bar] : bar * barDurSec
          const x = (barTime / totalDuration) * W

          const isPhrase = bar % 8 === 0
          const is16 = bar % 16 === 0
          ctx.strokeStyle = is16 ? 'rgba(212,166,79,0.5)' : isPhrase ? 'rgba(212,166,79,0.3)' : 'rgba(212,166,79,0.1)'
          ctx.lineWidth = is16 ? 1.5 : isPhrase ? 1 : 0.5
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, H)
          ctx.stroke()

          // Phrase labels
          if (bar % 8 === 0 && bar > 0) {
            ctx.fillStyle = 'rgba(212,166,79,0.4)'
            ctx.font = '8px monospace'
            ctx.textAlign = 'center'
            const nextBarTime = useRealGrid 
              ? (bar + 1 < downbeats.length ? downbeats[bar + 1] : barTime + barDurSec)
              : (bar + 1) * barDurSec
            const nextX = (nextBarTime / totalDuration) * W
            ctx.fillText(`${bar+1}`, x + (nextX - x) / 2, H - 3)
          }
        }
      }

      // Draw synthetic waveform (simplified envelope)
      const numPeaks = 512
      const peakWidth = W / numPeaks
      for (let i = 0; i < numPeaks; i++) {
        const phase = (i / numPeaks) * Math.PI * 8
        const env = Math.abs(Math.sin(phase)) * (0.3 + 0.7 * (1 - i / numPeaks))
        const amp = env * H * 0.4
        const x = i * peakWidth
        ctx.fillStyle = isActive ? `rgba(212,166,79,${0.2 + 0.3 * env})` : `rgba(255,255,255,${0.05 + 0.1 * env})`
        ctx.fillRect(x, H/2 - amp, Math.max(1, peakWidth), amp * 2)
      }

      // Playhead position (only if active and playing)
      if (isActive && status && (status.deckA || status.deckB)) {
        const pos = status.posSecA || status.posSecB || 0
        const px = (pos / totalDuration) * W
        ctx.strokeStyle = '#ff4444'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(px, 0)
        ctx.lineTo(px, H)
        ctx.stroke()

        // Playhead glow
        const grad = ctx.createRadialGradient(px, H/2, 0, px, H/2, 20)
        grad.addColorStop(0, 'rgba(255,68,68,0.3)')
        grad.addColorStop(1, 'rgba(255,68,68,0)')
        ctx.fillStyle = grad
        ctx.fillRect(px - 20, 0, 40, H)
      }
    }

    draw()
    animRef.current = setInterval(draw, POLL_MS)
    return () => clearInterval(animRef.current)
  }, [isActive, status, genreTracks, bpm])

  return (
    <div
      className={`genre-strip ${isActive ? 'active' : ''} ${isLoading ? 'loading' : ''}`}
      onClick={onClick}
      style={{ borderLeftColor: genre.color }}
    >
      <div className="strip-label">
        <div className="strip-genre" style={{ color: genre.color }}>{genre.folder}</div>
        <div className="strip-meta">
          {bpm > 0 && <span className="strip-bpm">{bpm.toFixed(1)}</span>}
          {key && <span className="strip-key">{key}</span>}
          <span className="strip-tracks">{genreTracks.length}</span>
        </div>
      </div>
      <div className="strip-waveform">
        <canvas ref={canvasRef} width={600} height={40} />
      </div>
      <div className="strip-controls">
        {isLoading ? (
          <span className="strip-loading">⟳</span>
        ) : isActive ? (
          <span className="strip-playing">▶</span>
        ) : (
          <span className="strip-preview">◉</span>
        )}
      </div>
    </div>
  )
}
