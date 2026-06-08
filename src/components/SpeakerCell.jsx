import React, { useEffect, useRef } from 'react'

export default function SpeakerCell({ genre, idx = 0, active, bass, bandBass = 0, treble, isPlaying, fxMode = false, onTap }) {
  const canvasRef = useRef(null)
  const liveRef   = useRef({ bass: 0, bandBass: 0, isPlaying: false, active: false })
  const ringsRef  = useRef([])
  const prevBand  = useRef(0)

  useEffect(() => { liveRef.current = { bass, bandBass, isPlaying, active } })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf = 0

    function resize() {
      canvas.width  = canvas.offsetWidth  || 100
      canvas.height = canvas.offsetHeight || 100
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    function tick() {
      raf = requestAnimationFrame(tick)
      const { bandBass: bb, isPlaying: ip, active: act } = liveRef.current
      const w = canvas.width, h = canvas.height
      const cx = w / 2, cy = h / 2
      const maxR = Math.sqrt(cx * cx + cy * cy)

      // spawn ring on sharp band hit — active speaker spawns more, bigger
      const threshold = act ? 0.12 : 0.22
      const deltaMin  = act ? 0.02 : 0.05
      if (ip && bb > threshold && bb > prevBand.current + deltaMin) {
        const count = act ? Math.ceil(bb * 3) : 1
        for (let k = 0; k < count; k++) {
          ringsRef.current.push({
            r:       maxR * (act ? 0.06 : 0.10),
            opacity: act ? 0.55 + bb * 0.45 : 0.12 + bb * 0.25,
            speed:   act ? 2.8 + bb * 5.5 : 1.2 + bb * 3.0,
            width:   act ? 1.2 + bb * 2.4 : 0.6 + bb * 1.0,
            delay:   k * 40,
          })
        }
      }
      prevBand.current = bb

      ctx.clearRect(0, 0, w, h)

      // active center glow — aggressive red flood
      if (ip && act && bb > 0) {
        // inner hard red core
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * (0.30 + bb * 0.40))
        grd.addColorStop(0,   `rgba(255,${Math.round(20 + bb * 40)},20,${(bb * 0.72).toFixed(3)})`)
        grd.addColorStop(0.4, `rgba(220,30,30,${(bb * 0.38).toFixed(3)})`)
        grd.addColorStop(1,   'rgba(0,0,0,0)')
        ctx.fillStyle = grd
        ctx.fillRect(0, 0, w, h)
        // outer bleed — bleeds past edges on big hits
        if (bb > 0.5) {
          const bleed = ctx.createRadialGradient(cx, cy, maxR * 0.3, cx, cy, maxR * 1.2)
          bleed.addColorStop(0, `rgba(180,0,0,${((bb - 0.5) * 0.30).toFixed(3)})`)
          bleed.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.fillStyle = bleed
          ctx.fillRect(0, 0, w, h)
        }
      } else if (ip && !act && bb > 0.1) {
        // inactive: very faint frequency response
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.35)
        grd.addColorStop(0,   `rgba(212,166,79,${(bb * 0.09).toFixed(3)})`)
        grd.addColorStop(1,   'rgba(0,0,0,0)')
        ctx.fillStyle = grd
        ctx.fillRect(0, 0, w, h)
      }

      // rings
      const rings = ringsRef.current
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i]
        if (ring.delay > 0) { ring.delay -= 16; continue }
        ring.r       += ring.speed
        ring.opacity -= act ? 0.024 : 0.014
        if (ring.opacity <= 0 || ring.r > maxR * 1.3) { rings.splice(i, 1); continue }

        ctx.beginPath()
        ctx.arc(cx, cy, ring.r, 0, Math.PI * 2)
        const color = act
          ? `rgba(255,${Math.round(20 + ring.opacity * 80)},20,${ring.opacity.toFixed(3)})`
          : `rgba(255,255,255,${(ring.opacity * 0.35).toFixed(3)})`
        ctx.strokeStyle = color
        ctx.lineWidth   = ring.width
        ctx.stroke()
      }

      // static surround rings — visible even at rest
      const staticRings = [0.20, 0.35, 0.50, 0.64]
      for (const frac of staticRings) {
        ctx.beginPath()
        ctx.arc(cx, cy, maxR * frac, 0, Math.PI * 2)
        ctx.strokeStyle = act
          ? `rgba(220,30,30,${ip ? 0.08 + bb * 0.14 : 0.06})`
          : `rgba(255,255,255,${ip ? 0.04 + bb * 0.04 : 0.025})`
        ctx.lineWidth = act ? 0.7 : 0.4
        ctx.stroke()
      }

      // waveform arc on active speaker — shows the band frequency as a ring warp
      if (ip && act && bb > 0.05) {
        const segments = 64
        const baseR = maxR * 0.45
        ctx.beginPath()
        for (let s = 0; s <= segments; s++) {
          const angle = (s / segments) * Math.PI * 2 - Math.PI / 2
          const warp  = 1 + Math.sin(angle * 4 + performance.now() * 0.006) * bb * 0.18
          const r     = baseR * warp
          const x = cx + Math.cos(angle) * r
          const y = cy + Math.sin(angle) * r
          s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.strokeStyle = `rgba(255,60,40,${(bb * 0.65).toFixed(3)})`
        ctx.lineWidth = 1.5 + bb * 2
        ctx.stroke()
      }
    }

    tick()
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
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
      className={`ss-cell ${active ? 'ss-cell--active' : ''}`}
      onClick={onTap}
      onPointerDown={fireSparkle}
      style={{
        boxShadow: isPlaying && b > 0.05
          ? `inset 0 0 ${Math.round(active ? b * 90 : b * 20)}px ${glowColor}${active && b > 0.6 ? `, 0 0 ${Math.round(b * 40)}px rgba(220,30,30,${(b * 0.25).toFixed(2)})` : ''}`
          : undefined,
      }}
    >
      <div className="ss-cell-img-wrap">
        <img
          src="/woofer.png"
          alt={genre.name}
          className="ss-woofer"
          style={{
            transform:  fxTransform,
            transition: fxTransition,
            filter: active
              ? `contrast(1.40) brightness(0.95) saturate(0.7) sepia(0.20)`
              : `contrast(1.22) brightness(0.78) saturate(0.45) sepia(0.12)`,
          }}
        />
        <canvas ref={canvasRef} className="ss-speaker-canvas" />
      </div>
      <span className="ss-cell-label">{genre.name}</span>
      {active && <span className="ss-cell-dot" />}
    </button>
  )
}
