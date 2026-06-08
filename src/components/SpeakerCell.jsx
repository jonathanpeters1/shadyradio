import React, { useEffect } from 'react'

export default function SpeakerCell({ genre, idx = 0, active, bass, bandBass = 0, treble, isPlaying, fxMode = false, dimmed = false, onTap }) {

  useEffect(() => {
    return () => {}
  }, [])

  // main pump — driven by bandBass, very aggressive on active
  const b = bandBass
  const pump = active && isPlaying
    ? 1 + b * 0.70           // active: violent
    : isPlaying ? 1 + b * 0.14 : 1

  const glowColor = active
    ? `rgba(220,30,30,${(b * 0.55).toFixed(2)})`
    : `rgba(80,80,80,${(b * 0.08).toFixed(2)})`

  // FX mode transforms
  const fxType = idx % 4
  let fxTransform = `scale(${pump.toFixed(3)})`
  let fxTransition = active
    ? 'transform 30ms cubic-bezier(0.1,2.2,0.3,1)'   // elastic snap on active
    : 'transform 80ms ease'
  if (fxMode && isPlaying) {
    if (fxType === 0) {
      fxTransform  = `scale(${(1 + b * 0.72).toFixed(3)})`
      fxTransition = 'transform 28ms cubic-bezier(0.05,2.4,0.2,1)'
    } else if (fxType === 1) {
      fxTransform  = `scaleX(${(1 + b * 0.58).toFixed(3)}) scaleY(${(1 + b * 0.22).toFixed(3)})`
      fxTransition = 'transform 35ms ease-out'
    } else if (fxType === 2) {
      fxTransform  = `scale(${(1 + b * 0.42).toFixed(3)}) rotate(${(b * 12).toFixed(1)}deg)`
      fxTransition = 'transform 42ms ease'
    } else {
      fxTransform  = `scale(${(1 + b * 0.62).toFixed(3)}) skewX(${(b * 9).toFixed(1)}deg)`
      fxTransition = 'transform 32ms cubic-bezier(0.2,0.8,0.4,1)'
    }
  }

  function fireSparkle(e) {
    if (!window.__sfSpark) window.__sfSpark = []
    window.__sfSpark.push({ x: e.clientX, y: e.clientY })
  }

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
          style={{ transform: fxTransform, transition: fxTransition }}
        />
      </div>
      <span className="ss-cell-label">{genre.name}</span>
      {active && <span className="ss-cell-dot" />}
    </button>
  )
}
