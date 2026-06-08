import React from 'react'

export default function SpeakerCell({ genre, idx = 0, active, bass, bandBass = 0, isPlaying, fxMode = false, dimmed = false, onTap }) {
  const b = bandBass

  // only the cone moves — subtle excursion, max 18%
  const coneScale = isPlaying ? 1 + b * 0.18 : 1
  const coneTransition = isPlaying
    ? 'transform 35ms cubic-bezier(0.1, 1.8, 0.3, 1)'
    : 'none'

  return (
    <button
      className={`ss-cell ${active ? 'ss-cell--active' : ''} ${dimmed ? 'ss-cell--dimmed' : ''}`}
      onClick={onTap}
    >
      <div className="ss-cell-img-wrap">
        {/* speaker frame — never moves */}
        <img src="/woofer.png" alt={genre.name} className="ss-woofer" />

        {/* cone overlay — only this pulses with the beat */}
        <div className="ss-cone-wrap">
          <div
            className="ss-cone-pulse"
            style={{ transform: `scale(${coneScale.toFixed(3)})`, transition: coneTransition }}
          />
        </div>
      </div>

      <span className="ss-cell-label">{genre.name}</span>
      {active && <span className="ss-cell-dot" />}
    </button>
  )
}
