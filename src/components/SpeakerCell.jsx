import React from 'react'

export default function SpeakerCell({ genre, idx = 0, active, bass, bandBass = 0, isPlaying, dimmed = false, onTap }) {
  const b = bandBass

  // woofer image scales with the beat — cell/frame never moves
  const scale = isPlaying ? 1 + b * 0.28 : 1

  return (
    <button
      className={`ss-cell ${active ? 'ss-cell--active' : ''} ${dimmed ? 'ss-cell--dimmed' : ''}`}
      onClick={onTap}
    >
      <div className="ss-cell-img-wrap">
        <img
          src="/woofer.png"
          alt={genre.name}
          className="ss-woofer"
          style={{
            transform: `scale(${scale.toFixed(3)})`,
            transition: isPlaying ? 'transform 40ms cubic-bezier(0.1,1.6,0.3,1)' : 'none',
          }}
        />
      </div>
      <span className="ss-cell-label">{genre.name}</span>
      {active && <span className="ss-cell-dot" />}
    </button>
  )
}
