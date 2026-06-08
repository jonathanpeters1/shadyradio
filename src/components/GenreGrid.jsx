import React, { useState, useEffect, useRef } from 'react'
import SFHeroSphere from './SFHeroSphere'
import SFParticleField from './SFParticleField'
import './GenreGrid.css'

const GENRES = [
  { name: 'Afro House',                      slug: 'afro-house' },
  { name: 'Deep House',                       slug: 'deep-house' },
  { name: 'Deep Tech',                        slug: 'deep-tech' },
  { name: 'Disco',                            slug: 'disco' },
  { name: 'Funky House',                      slug: 'funky-house' },
  { name: 'House',                            slug: 'house' },
  { name: 'Indie Dance',                      slug: 'indie-dance' },
  { name: 'JP Sets',                          slug: 'jp-sets' },
  { name: 'Jackin House',                     slug: 'jackin-house' },
  { name: 'Melodic House & Techno',           slug: 'melodic-house-techno' },
  { name: 'Minimal Deep Tech',                slug: 'minimal-deep-tech' },
  { name: 'Progressive House',               slug: 'progressive-house' },
  { name: 'Soul Funk Disco',                  slug: 'soul-funk-disco' },
  { name: 'Tech House',                       slug: 'tech-house' },
  { name: 'Techno (Peak Time Driving)',        slug: 'techno-peak', locked: true },
  { name: 'Techno (Raw Deep Hypnotic)',        slug: 'techno-raw', locked: true },
]

export default function GenreGrid({ onGenreSelect }) {
  const [activeGenre, setActiveGenre] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [bass, setBass] = useState(0)
  const [treble, setTreble] = useState(0)
  const [mixMode, setMixMode] = useState('radio')
  const playingRef = useRef(false)

  // Simulate bass/treble pulse while playing (replace with WebSocket METER data)
  useEffect(() => {
    playingRef.current = isPlaying
    if (!isPlaying) { setBass(0); setTreble(0); return }
    let raf = 0
    let t = 0
    function tick() {
      t += 0.016
      setBass(Math.max(0, Math.sin(t * 2.1) * 0.45 + Math.sin(t * 5.3) * 0.15 + 0.25))
      setTreble(Math.max(0, Math.sin(t * 3.7) * 0.3 + 0.1))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying])

  function selectGenre(genre) {
    if (genre.locked) return
    if (activeGenre?.slug === genre.slug) {
      setActiveGenre(null)
      setIsPlaying(false)
    } else {
      setActiveGenre(genre)
      setIsPlaying(true)
      onGenreSelect?.(genre)
    }
  }

  const nowPlayingLabel = activeGenre
    ? mixMode === 'radio' ? '✦ NOW PLAYING ✦'
      : mixMode === 'club' ? '✦ CLUB ✦'
      : mixMode === 'vocal' ? '✦ VOCALS ✦'
      : '✦ SHADY LIVE ✦'
    : '✦ SOUNDFACTORY ✦'

  return (
    <div className="genre-container">

      {/* ── Hero Stage ── */}
      <div className="hero-stage">
        <div className="hero-grid-bg" />

        {/* particle field — full-opacity atmospheric bg */}
        <div className="hero-particles">
          <SFParticleField
            bass={bass}
            treble={treble}
            isPlaying={isPlaying}
            morphToLips={mixMode === 'club'}
          />
        </div>

        {/* 3D interactive sphere — right half */}
        <div className="hero-sphere">
          <SFHeroSphere bass={bass} treble={treble} isPlaying={isPlaying} />
        </div>

        {/* now-playing info — left side */}
        <div className="hero-info">
          <p className="hero-label">{nowPlayingLabel}</p>
          {activeGenre ? (
            <>
              <p className="hero-title">{activeGenre.name}</p>
              <div className="hero-meta">
                <span className="hero-bpm">~{Math.round(128 + bass * 24)} BPM</span>
                <span className="hero-live-dot" />
                <span className="hero-live-text">LIVE</span>
              </div>
            </>
          ) : (
            <p className="hero-title hero-title--idle">Select a Channel</p>
          )}
        </div>

        {/* mode badge */}
        <div className={`hero-mode-badge hero-mode-badge--${mixMode}`}>
          {mixMode.toUpperCase()}
        </div>

        {/* mode strip */}
        <div className="hero-mode-strip">
          {['radio', 'club', 'vocal'].map(m => (
            <button
              key={m}
              className={`hero-mode-btn ${mixMode === m ? 'hero-mode-btn--active' : ''}`}
              onClick={() => setMixMode(m)}
            >
              {m}
            </button>
          ))}
        </div>

        {/* bottom fade */}
        <div className="hero-fade-bottom" />
      </div>

      {/* ── Genre Grid ── */}
      <div className="genre-grid">
        <div className="grid">
          {GENRES.map((genre) => (
            <button
              key={genre.slug}
              className={`genre-card ${genre.locked ? 'locked' : ''} ${activeGenre?.slug === genre.slug ? 'active' : ''}`}
              disabled={genre.locked}
              onClick={() => selectGenre(genre)}
            >
              <img
                src="/woofer.png"
                alt="speaker"
                className="speaker-image"
                style={{ transform: `scale(${activeGenre?.slug === genre.slug ? 1 + bass * 0.28 : 1})`, transition: 'transform 70ms cubic-bezier(0.2,0.8,0.3,1)' }}
              />
              <div className="genre-content">
                <h3>{genre.name}</h3>
              </div>
              {genre.locked && <div className="lock-badge">🔒</div>}
              {activeGenre?.slug === genre.slug && <div className="active-badge" />}
            </button>
          ))}
        </div>
      </div>

    </div>
  )
}
