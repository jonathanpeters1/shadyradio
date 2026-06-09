import React from 'react'

export default function SpeakerCell({
  genre,
  idx = 0,
  active,
  activeChannel,
  bass,
  bandBass = 0,
  isPlaying,
  dimmed = false,
  pending = false,
  shadow = false,
  crossfadeProgress = 0,
  bpm = 0,
  bpmLocked = false,
  keyLabel = null,
  phrasePhase = 0,
  onTap
}) {
  const b = bandBass
  // Real cone excursion: tiny forward push (3-5% scale) + brightness spike as cone faces you
  const scale      = isPlaying ? 1 + b * 0.045 : 1
  const brightness = isPlaying ? 1 + b * 0.9   : 1   // center flares bright on each hit

  // Show crossfade progress bar if this is the active channel and crossfading
  const showCrossfade = active && crossfadeProgress > 0 && crossfadeProgress < 1

  // Show BPM badge only when locked
  const showBpm = bpm > 0 && bpmLocked

  // Show key badge when available
  const showKey = keyLabel && keyLabel.length > 0

  // Phrase bar visible when channel is active (playing)
  const showPhrase = isPlaying && phrasePhase >= 0

  return (
    <button
      className={`ss-cell ${active ? 'ss-cell--active' : ''} ${dimmed ? 'ss-cell--dimmed' : ''} ${pending ? 'ss-cell--pending' : ''} ${shadow ? 'ss-cell--shadow' : ''}`}
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

      {/* Top-left: BPM badge (only when locked) */}
      {showBpm && (
        <span className="ss-bpm-badge">{Math.round(bpm)}</span>
      )}

      {/* Top-right: Camelot key badge */}
      {showKey && (
        <span className="ss-key-badge">{keyLabel}</span>
      )}

      {/* Top edge: crossfade progress bar (only during crossfade) */}
      {showCrossfade && (
        <div className="ss-crossfade-bar" style={{ width: `${crossfadeProgress * 100}%` }} />
      )}

      {/* Bottom edge: phrase progress bar (0→1 over 8 bars) */}
      {showPhrase && (
        <div className="ss-phrase-bar" style={{ width: `${phrasePhase * 100}%` }} />
      )}

      <span className="ss-cell-label">
        {genre.name}
      </span>

      {active && <span className="ss-cell-dot" />}
    </button>
  )
}
