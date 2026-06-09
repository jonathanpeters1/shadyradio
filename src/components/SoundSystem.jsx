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

// ── 2-deck automix constants ──────────────────────────────────────────────────
// Deck A = WASM channel 0, Deck B = WASM channel 1.
// We load tracks alternately: A plays, meanwhile B is loaded and waiting.
// After CROSSFADE_BARS bars, WASM gains cross A→B. Then B plays, A loads next.
const DECK_A = 0
const DECK_B = 1
const CROSSFADE_BARS  = 8    // how many bars the xfade lasts
const MIX_POINT_BARS  = 32   // play this many bars before starting xfade

export default function SoundSystem() {
  const [active, setActive]         = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [activeBpm, setActiveBpm]   = useState(0)
  const [crossfade, setCrossfade]   = useState(0)
  const [nowPlaying, setNowPlaying] = useState(null)  // track name string
  const [nextName, setNextName]     = useState(null)
  const [gridOpen, setGridOpen]     = useState(false)

  const playlistsRef  = useRef({})     // slug → [track,...]
  const activeRef     = useRef(null)   // current slug
  const runningRef    = useRef(false)  // mix loop active
  const deckRef       = useRef(DECK_A) // which deck is currently outgoing
  const xfadeTimer    = useRef(null)

  useEffect(() => { activeRef.current = active }, [active])

  // ── meter callback ────────────────────────────────────────────────────────
  useEffect(() => {
    audioManager.onMeterUpdate((meters) => {
      setActiveBpm(meters[19] || 0)
      setCrossfade(meters[18] || 0)
    })
    return () => audioManager.onMeterUpdate(null)
  }, [])

  // ── helpers ───────────────────────────────────────────────────────────────
  function pickTrack(tracks, excludeUrl = null) {
    const pool = tracks.length > 1 ? tracks.filter(t => t.url !== excludeUrl) : tracks
    return pool[Math.floor(Math.random() * pool.length)]
  }

  async function fetchPlaylist(slug) {
    if (playlistsRef.current[slug]) return playlistsRef.current[slug]
    const res = await fetch(`/api/playlist/${slug}`)
    if (!res.ok) throw new Error(`Playlist fetch failed (${res.status})`)
    const raw = await res.json()
    const tracks = (raw || []).filter(t => t.bpm >= 60 && t.bpm <= 200)
    if (!tracks.length) throw new Error('No analyzed tracks in playlist yet')
    playlistsRef.current[slug] = tracks
    return tracks
  }

  // Load a track onto a deck (channel), send BPM hint to WASM
  async function loadDeck(deckCh, track) {
    console.log(`[Mix] Loading deck ${deckCh === DECK_A ? 'A' : 'B'}: ${track.name.slice(0,50)} @ ${track.bpm}bpm`)
    const buffer = await audioManager.fetchDecode(track.url)
    // Deactivate the deck first so automix gain resets cleanly
    audioManager.workletNode?.port.postMessage({ type: 'set-active', channel: deckCh, value: 0 })
    // Push BPM hint so WASM beat tracker seeds immediately
    audioManager.workletNode?.port.postMessage({ type: 'set-bpm-hint', channel: deckCh, value: track.bpm })
    // playBuffer sets active=1 and pushes first 8 chunks
    audioManager.playBuffer(deckCh, buffer, null, track.gridOffsetSec || 0, track.bpm)
    return buffer
  }

  // Crossfade from outgoing deck to incoming deck over CROSSFADE_BARS bars
  function startCrossfade(outDeck, inDeck, bpm) {
    const barDur     = (60 / bpm) * 4 * 1000  // ms per bar
    const xfadeDurMs = barDur * CROSSFADE_BARS
    const steps      = 40
    const stepMs     = xfadeDurMs / steps

    console.log(`[Mix] Crossfade ${outDeck === DECK_A ? 'A' : 'B'} → ${inDeck === DECK_A ? 'A' : 'B'} over ${(xfadeDurMs/1000).toFixed(1)}s`)

    let step = 0
    const tick = () => {
      if (!runningRef.current) return
      step++
      const t    = step / steps
      const outG = Math.cos(t * Math.PI / 2)   // 1→0
      const inG  = Math.sin(t * Math.PI / 2)   // 0→1
      audioManager.setChannelVolume(outDeck, outG)
      audioManager.setChannelVolume(inDeck,  inG)
      setCrossfade(t)
      if (step < steps) {
        xfadeTimer.current = setTimeout(tick, stepMs)
      } else {
        // Crossfade complete — silence and deactivate outgoing deck
        audioManager.setChannelVolume(outDeck, 0)
        audioManager.stop(outDeck)
        setCrossfade(0)
        console.log(`[Mix] Crossfade complete`)
      }
    }
    xfadeTimer.current = setTimeout(tick, stepMs)
  }

  // ── main automix loop ─────────────────────────────────────────────────────
  async function runMixLoop(slug) {
    runningRef.current = true
    const tracks = await fetchPlaylist(slug)

    // Pick first track → Deck A
    let trackA = pickTrack(tracks)
    setNowPlaying(trackA.name.replace(/\.wav$/i,'').replace(/^\d+[A-Za-z#]*\s*[-–]\s*/,'').slice(0,60))
    audioManager.setMasterBpm(trackA.bpm)
    await loadDeck(DECK_A, trackA)
    audioManager.setChannelVolume(DECK_A, 1)
    audioManager.setChannelVolume(DECK_B, 0)
    deckRef.current = DECK_A

    // Pre-fetch Deck B while A plays
    let trackB = pickTrack(tracks, trackA.url)
    let bufBPromise = audioManager.fetchDecode(trackB.url)
    setNextName(trackB.name.replace(/\.wav$/i,'').replace(/^\d+[A-Za-z#]*\s*[-–]\s*/,'').slice(0,60))

    while (runningRef.current) {
      const outDeck  = deckRef.current
      const inDeck   = outDeck === DECK_A ? DECK_B : DECK_A
      const curTrack = outDeck === DECK_A ? trackA : trackB
      const nxtTrack = outDeck === DECK_A ? trackB : trackA

      // Wait MIX_POINT_BARS bars at current BPM before crossfading
      const barDur    = (60 / curTrack.bpm) * 4 * 1000
      const waitMs    = barDur * MIX_POINT_BARS
      console.log(`[Mix] Playing ${MIX_POINT_BARS} bars (${(waitMs/1000).toFixed(0)}s) before mix`)
      await sleep(waitMs)
      if (!runningRef.current) break

      // Ensure incoming track buffer is decoded
      await bufBPromise
      audioManager.workletNode?.port.postMessage({ type: 'set-bpm-hint', channel: inDeck, value: nxtTrack.bpm })

      // Load incoming deck silently
      const inBuf = await bufBPromise
      audioManager.workletNode?.port.postMessage({ type: 'set-active', channel: inDeck, value: 0 })
      audioManager.workletNode?.port.postMessage({ type: 'set-bpm-hint', channel: inDeck, value: nxtTrack.bpm })
      audioManager.playBuffer(inDeck, inBuf, null, nxtTrack.gridOffsetSec || 0, nxtTrack.bpm)
      audioManager.setChannelVolume(inDeck, 0)

      setNowPlaying(nxtTrack.name.replace(/\.wav$/i,'').replace(/^\d+[A-Za-z#]*\s*[-–]\s*/,'').slice(0,60))

      // Pick the track after that and start pre-fetching it
      const afterTrack = pickTrack(tracks, nxtTrack.url)
      bufBPromise = audioManager.fetchDecode(afterTrack.url)
      setNextName(afterTrack.name.replace(/\.wav$/i,'').replace(/^\d+[A-Za-z#]*\s*[-–]\s*/,'').slice(0,60))

      // Do the crossfade
      startCrossfade(outDeck, inDeck, curTrack.bpm)

      // Wait for the crossfade to complete
      const xfadeDur = (barDur * CROSSFADE_BARS)
      await sleep(xfadeDur + 100)
      if (!runningRef.current) break

      // Swap deck reference and track references
      deckRef.current = inDeck
      if (inDeck === DECK_A) { trackA = nxtTrack; trackB = afterTrack }
      else                   { trackB = nxtTrack; trackA = afterTrack }
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ── tap a genre button ────────────────────────────────────────────────────
  async function tapGenre(slug) {
    // Stop if already playing this genre
    if (active === slug) {
      stopAll()
      return
    }

    // Stop current mix
    if (runningRef.current) stopAll()

    setLoading(true)
    setError(null)

    try {
      await audioManager.initialize()
      setActive(slug)
      activeRef.current = slug
      runMixLoop(slug).catch(e => {
        console.error('[Mix] loop error:', e)
        setError(e.message)
      })
    } catch (e) {
      console.error('[SoundSystem] tapGenre error:', e)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── stop all ──────────────────────────────────────────────────────────────
  function stopAll() {
    runningRef.current = false
    if (xfadeTimer.current) { clearTimeout(xfadeTimer.current); xfadeTimer.current = null }
    audioManager.stop(DECK_A)
    audioManager.stop(DECK_B)
    setActive(null)
    activeRef.current = null
    setNowPlaying(null)
    setNextName(null)
    setCrossfade(0)
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
                  MIX {Math.round(crossfade * 100)}%
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

      {/* Now playing */}
      {nowPlaying && (
        <div style={{
          position: 'absolute', top: '2.8rem', left: 0, right: 0,
          padding: '0.2rem 0.75rem', fontSize: '0.6rem',
          color: 'rgba(212,166,79,0.7)', letterSpacing: '0.04em',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          pointerEvents: 'none',
        }}>
          ▶ {nowPlaying}
          {nextName && crossfade === 0 && (
            <span style={{ color: 'rgba(255,255,255,0.3)', marginLeft: '1rem' }}>
              next: {nextName}
            </span>
          )}
        </div>
      )}

      {/* Loading / error */}
      {loading && <div className="ss-loading"><span>Loading…</span></div>}
      {error && (
        <div style={{
          position: 'absolute', top: '3rem', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(200,0,0,0.8)', color: '#fff', padding: '0.4rem 0.8rem',
          borderRadius: '4px', fontSize: '0.75rem', zIndex: 50,
        }}>
          {error}
        </div>
      )}

      {/* 16-channel speaker grid */}
      <div className="ss-canvas">
        <div className="ss-grid" style={{ paddingTop: '3.5rem' }}>
          {GENRES.map((g) => {
            const isActive = active === g.slug
            return (
              <button
                key={g.slug}
                className={`ss-speaker-cell${isActive ? ' ss-speaker-cell--active' : ''}`}
                onClick={() => tapGenre(g.slug)}
                style={{
                  borderColor: isActive ? 'rgba(212,166,79,0.7)' : undefined,
                }}
              >
                <span className="ss-cell-name">{g.name}</span>
                {isActive && <span className="ss-cell-playing">▶</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
