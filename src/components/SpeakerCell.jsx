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
  // Normalize raw RMS (0.001–0.15) to pump drive 0–1
  const b = Math.min(1, bandBass * 8)
  // Per-speaker variety so cones don't all move identically
  const variety = 0.55 + ((idx * 37 + 3) % 10) * 0.05
  const scale      = isPlaying ? 1 + b * 0.09 * variety : 1
  const brightness = isPlaying ? 1 + b * 2.4 * variety : 1

  // Active speaker: ambient gold glow that breathes with the beat
  const glowPx = active ? (isPlaying ? 16 + b * 38 : 16) : 0
  const glowA  = active ? (isPlaying ? 0.28 + b * 0.52 : 0.22) : 0

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
      style={active ? { boxShadow: `0 0 ${glowPx.toFixed(1)}px rgba(212,166,79,${glowA.toFixed(2)})` } : undefined}
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
