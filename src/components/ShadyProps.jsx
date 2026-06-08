import { useEffect, useRef } from 'react'

// drag queen fan — canvas animated prop in the stage area
export default function ShadyProps({ isActive }) {
  const canvasRef = useRef(null)
  const hostRef   = useRef(null)
  const fanRef    = useRef({ phase: 'idle', openAng: 0, rot: -Math.PI / 2, opacity: 0 })

  useEffect(() => {
    const fan = fanRef.current
    if (isActive) {
      fan.phase   = 'enter'
      fan.openAng = 0
      fan.opacity = 0
    } else {
      if (fan.phase !== 'idle') fan.phase = 'exit'
    }
  }, [isActive])

  useEffect(() => {
    const canvas = canvasRef.current, host = hostRef.current
    if (!canvas || !host) return
    const ctx = canvas.getContext('2d')
    let raf = 0, w = 0, h = 0

    function resize() {
      const rect = host.getBoundingClientRect()
      w = Math.max(1, rect.width)
      h = Math.max(1, rect.height)
      canvas.width  = w
      canvas.height = h
    }

    function drawFan(cx, cy, openAng, rot, alpha) {
      if (openAng < 0.01 || alpha < 0.01) return
      const ribLen  = Math.min(w * 0.24, h * 0.52)
      const numRibs = 13
      const startA  = rot - openAng / 2

      ctx.save()
      ctx.translate(cx, cy)
      ctx.globalAlpha = alpha

      // fabric panels — alternating gold / deep red
      for (let i = 0; i < numRibs - 1; i++) {
        const a0 = startA + (i / (numRibs - 1)) * openAng
        const a1 = startA + ((i + 1) / (numRibs - 1)) * openAng
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(Math.cos(a0) * ribLen, Math.sin(a0) * ribLen)
        ctx.arc(0, 0, ribLen, a0, a1)
        ctx.lineTo(0, 0)
        ctx.fillStyle = i % 2 === 0
          ? 'rgba(212,155,55,0.82)'
          : 'rgba(200,28,48,0.78)'
        ctx.fill()
      }

      // decorative inner arc
      ctx.beginPath()
      ctx.arc(0, 0, ribLen * 0.30, startA, startA + openAng)
      ctx.strokeStyle = 'rgba(255,220,120,0.55)'
      ctx.lineWidth   = ribLen * 0.022
      ctx.stroke()

      // outer arc border
      ctx.beginPath()
      ctx.arc(0, 0, ribLen * 0.97, startA, startA + openAng)
      ctx.strokeStyle = 'rgba(255,210,100,0.50)'
      ctx.lineWidth   = ribLen * 0.016
      ctx.stroke()

      // ribs
      for (let i = 0; i < numRibs; i++) {
        const ang = startA + (i / (numRibs - 1)) * openAng
        const tx  = Math.cos(ang) * ribLen
        const ty  = Math.sin(ang) * ribLen

        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(tx, ty)
        ctx.strokeStyle = 'rgba(255,235,150,0.92)'
        ctx.lineWidth   = Math.max(1.2, ribLen * 0.020)
        ctx.lineCap     = 'round'
        ctx.stroke()

        // jewel at tip
        ctx.beginPath()
        ctx.arc(tx, ty, ribLen * 0.028, 0, Math.PI * 2)
        ctx.fillStyle = i % 3 === 0 ? '#ff2040' : '#ffd700'
        ctx.fill()
      }

      // pivot jewel
      ctx.beginPath()
      ctx.arc(0, 0, ribLen * 0.048, 0, Math.PI * 2)
      ctx.fillStyle = '#ffd700'
      ctx.shadowColor = 'rgba(255,200,0,0.8)'
      ctx.shadowBlur  = 8
      ctx.fill()
      ctx.shadowBlur  = 0

      ctx.restore()
    }

    function render() {
      raf = requestAnimationFrame(render)
      const fan = fanRef.current
      const t   = performance.now() / 1000

      ctx.clearRect(0, 0, w, h)

      if (fan.phase === 'enter') {
        fan.openAng += 0.18                           // snap open fast
        fan.opacity  = Math.min(fan.opacity + 0.08, 1)
        if (fan.openAng >= Math.PI * 0.74) {
          fan.openAng = Math.PI * 0.74
          fan.phase   = 'wave'
        }
      } else if (fan.phase === 'wave') {
        fan.openAng  = Math.PI * 0.74                // stay fully open
        fan.opacity  = Math.min(fan.opacity + 0.05, 1)
        // sassy wave — rotation oscillates, slight size breathe
        fan.rot      = -Math.PI / 2 + Math.sin(t * 2.0) * 0.24
      } else if (fan.phase === 'exit') {
        fan.openAng  = Math.max(fan.openAng - 0.20, 0)  // snap shut fast
        fan.opacity  = Math.max(fan.opacity - 0.07, 0)
        if (fan.openAng <= 0) fan.phase = 'idle'
      }

      if (fan.phase !== 'idle') {
        // position: lower-right corner of stage, like she's holding it
        const cx = w * 0.76
        const cy = h * 0.82
        drawFan(ctx, cx, cy, fan.openAng, fan.rot, fan.opacity)
      }
    }

    resize()
    render()

    const ro = new ResizeObserver(resize)
    ro.observe(host)

    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return (
    <div
      ref={hostRef}
      style={{
        position:      'absolute',
        top: 0, left: 0, right: 0,
        height:        '36%',
        pointerEvents: 'none',
        zIndex:        9,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  )
}
