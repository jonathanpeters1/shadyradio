import React from 'react'

export default function SpeakerCell({ genre, idx = 0, active, activeChannel, bass, bandBass = 0, isPlaying, dimmed = false, crossfadeProgress = 0, bpm = 0, onTap }) {
  const b = bandBass
  // Real cone excursion: tiny forward push (3-5% scale) + brightness spike as cone faces you
  const scale      = isPlaying ? 1 + b * 0.045 : 1
  const brightness = isPlaying ? 1 + b * 0.9   : 1   // center flares bright on each hit

  // Show crossfade progress bar if this is the active channel and crossfading
  const showProgress = active && crossfadeProgress > 0 && crossfadeProgress < 1;

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
      <span className="ss-cell-label">
        {genre.name}
        {active && bpm > 0 && <span className="ss-cell-bpm">{Math.round(bpm)} BPM</span>}
      </span>
      {active && <span className="ss-cell-dot" />}
      {showProgress && (
        <div className="ss-crossfade-bar">
          <div className="ss-crossfade-fill" style={{ width: `${crossfadeProgress * 100}%` }} />
        </div>
      )}
    </button>
  )
}
