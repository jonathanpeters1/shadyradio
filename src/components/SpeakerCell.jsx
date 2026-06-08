import React from 'react'

export default function SpeakerCell({ genre, idx = 0, active, bass, bandBass = 0, isPlaying, dimmed = false, onTap }) {
  const b = bandBass
  const scale = isPlaying ? 1 + b * 0.32 : 1

  return (
    <button
      className={`ss-cell ${active ? 'ss-cell--active' : ''} ${dimmed ? 'ss-cell--dimmed' : ''}`}
      onClick={onTap}
    >
      <div className="ss-cell-img-wrap">

        {/* layer 1 — full speaker image, frame never moves */}
        <img src="/woofer.png" alt={genre.name} className="ss-woofer" />

        {/* layer 2 — same image clipped to cone only, this pumps */}
        <img
          src="/woofer.png"
          aria-hidden="true"
          className="ss-woofer ss-woofer-cone"
          style={{
            transform: `scale(${scale.toFixed(3)})`,
            transition: isPlaying ? 'transform 38ms cubic-bezier(0.1,1.8,0.3,1)' : 'none',
          }}
        />

      </div>
      <span className="ss-cell-label">{genre.name}</span>
      {active && <span className="ss-cell-dot" />}
    </button>
  )
}
