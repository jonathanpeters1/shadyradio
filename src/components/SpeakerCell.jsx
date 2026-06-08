import React from 'react'

export default function SpeakerCell({ genre, idx = 0, active, bass, bandBass = 0, isPlaying, dimmed = false, onTap }) {
  const b = bandBass
  // Real cone excursion: tiny forward push (3-5% scale) + brightness spike as cone faces you
  const scale      = isPlaying ? 1 + b * 0.045 : 1
  const brightness = isPlaying ? 1 + b * 0.9   : 1   // center flares bright on each hit

  return (
    <button
      className={`ss-cell ${active ? 'ss-cell--active' : ''} ${dimmed ? 'ss-cell--dimmed' : ''}`}
      onClick={onTap}
    >
      <div className="ss-cell-img-wrap">

        {/* layer 1 — full speaker including frame, always static */}
        <img src="/woofer.png" alt={genre.name} className="ss-woofer" />

        {/* layer 2 — cone only: pushes forward (brightness) + micro-scale snap */}
        <img
          src="/woofer.png"
          aria-hidden="true"
          className="ss-woofer ss-woofer-cone"
          style={{
            transform:  `scale(${scale.toFixed(4)})`,
            filter:     `brightness(${brightness.toFixed(3)}) contrast(1.55) saturate(0.55) sepia(0.04)`,
            transition: isPlaying ? 'transform 18ms linear, filter 18ms linear' : 'none',
          }}
        />

      </div>
      <span className="ss-cell-label">{genre.name}</span>
      {active && <span className="ss-cell-dot" />}
    </button>
  )
}
