import React, { useState, useEffect, useRef } from 'react'
import GridTool from './GridTool'
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
  { name: 'Deep Tech',                slug: 'hard-techno' },
  { name: 'Minimal Deep Tech',        slug: 'minimal-deep-tech' },
  { name: 'Nu Disco',                 slug: 'nu-disco' },
  { name: 'JP Sets',                  slug: 'jp-sets' },
  { name: 'JP Classics',              slug: 'jp-classics' },
  { name: 'Disco',                    slug: 'amapiano' },
  { name: 'Soulful & Funk',           slug: 'soul-funk-disco' },
]

export default function SoundSystem() {
  const [active, setActive]         = useState(null)   // slug of playing genre
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [activeBpm, setActiveBpm]   = useState(0)
  const [crossfade, setCrossfade]   = useState(0)
  const [gridOpen, setGridOpen]     = useState(false)
  const [channelRms, setChannelRms] = useState(Array(16).fill(0))

  // Track which channel index is currently active in WASM
  const activeChRef = useRef(-1)

  // Set up meter callback once
  useEffect(() => {
    audioManager.onMeterUpdate((meters) => {
      setChannelRms(meters.slice(0, 16))
      setActiveBpm(meters[19] || 0)
      setCrossfade(meters[18] || 0)
      activeChRef.current = Math.round(meters[16])
    })
    return () => { audioManager.onMeterUpdate(null) }
  }, [])

  // ── tap a genre button ────────────────────────────────────────────────────
  async function tapGenre(slug) {
    const idx = GENRES.findIndex(g => g.slug === slug)
    if (idx < 0) return

    // If this genre is already playing, stop it
    if (active === slug) {
      audioManager.stop(idx)
      setActive(null)
      return
    }

    // Stop whatever was playing
    if (active !== null) {
      const prevIdx = GENRES.findIndex(g => g.slug === active)
      if (prevIdx >= 0) audioManager.stop(prevIdx)
    }

    setLoading(true)
    setError(null)

    try {
      await audioManager.initialize()

      // Fetch playlist from audio-server
      const res = await fetch(`/api/playlist/${slug}`)
      if (!res.ok) throw new Error(`Playlist fetch failed (${res.status})`)
      const tracks = await res.json()
      if (!tracks || tracks.length === 0) throw new Error('No tracks in playlist')

      // Pick a random track
      const track = tracks[Math.floor(Math.random() * tracks.length)]

      // Fetch + decode the audio
      const buffer = await audioManager.fetchDecode(track.url)

      // Set master BPM to this track's BPM
      audioManager.setMasterBpm(track.bpm)

      // Play it — start at bar 1 (gridOffsetSec)
      audioManager.playBuffer(idx, buffer, null, track.gridOffsetSec || 0, track.bpm)

      setActive(slug)
    } catch (e) {
      console.error('[SoundSystem] tapGenre error:', e)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── stop all ──────────────────────────────────────────────────────────────
  function stopAll() {
    if (active !== null) {
      const idx = GENRES.findIndex(g => g.slug === active)
      if (idx >= 0) audioManager.stop(idx)
    }
    setActive(null)
  }

  if (gridOpen) {
    return <GridTool onClose={() => setGridOpen(false)} />
  }

  return (
    <div className="ss-root">
      {/* Header */}
      <div className="ss-header">
        <div className="ss-logo">
          <img src="/sf-logo.jpeg" alt="SF" className="ss-logo-img" />
          <span className="ss-logo-text">SHADY RADIO</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {activeBpm > 0 && (
            <span style={{ fontSize: '0.75rem', color: 'rgba(212,166,79,0.9)', fontWeight: 700, letterSpacing: '0.05em' }}>
              {Math.round(activeBpm)} BPM
              {crossfade > 0 && crossfade < 1 && (
                <span style={{ marginLeft: '0.4rem', color: 'rgba(255,100,50,0.9)' }}>
                  XFADE {Math.round(crossfade * 100)}%
                </span>
              )}
            </span>
          )}
          {active && (
            <button className="ss-btn ss-btn--labeled" onClick={stopAll} style={{ pointerEvents: 'auto' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16"/>
              </svg>
              <span>Stop</span>
            </button>
          )}
          <button
            className="ss-btn ss-btn--labeled"
            style={{ borderColor: 'rgba(212,166,79,0.5)', color: 'rgba(212,166,79,0.9)' }}
            onClick={() => setGridOpen(true)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
            <span>Grid</span>
          </button>
        </div>
      </div>

      {/* Loading / error banners */}
      {loading && (
        <div className="ss-loading"><span>Loading…</span></div>
      )}
      {error && (
        <div style={{
          position: 'absolute', top: '3rem', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(200,0,0,0.8)', color: '#fff', padding: '0.4rem 0.8rem',
          borderRadius: '4px', fontSize: '0.75rem', zIndex: 50
        }}>
          {error}
        </div>
      )}

      {/* 16-channel grid */}
      <div className="ss-canvas">
        <div className="ss-grid" style={{ paddingTop: '3.5rem' }}>
          {GENRES.map((g, i) => {
            const isActive = active === g.slug
            const rms      = channelRms[i] || 0
            const glow     = isActive ? Math.min(rms * 400, 1) : 0
            return (
              <button
                key={g.slug}
                className={`ss-speaker-cell${isActive ? ' ss-speaker-cell--active' : ''}`}
                onClick={() => tapGenre(g.slug)}
                style={{
                  boxShadow: glow > 0.05
                    ? `0 0 ${8 + glow * 24}px rgba(212,166,79,${(glow * 0.7).toFixed(2)})`
                    : undefined,
                  borderColor: isActive ? 'rgba(212,166,79,0.7)' : undefined,
                }}
              >
                <span className="ss-cell-name">{g.name}</span>
                {isActive && (
                  <span className="ss-cell-playing">▶</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
