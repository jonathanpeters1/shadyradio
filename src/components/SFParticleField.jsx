import { useEffect, useRef } from 'react'

const STAGE   = 0.36
const HDR_PAD = 0.03

// ── Shady lips (closed) ──
function lipsPath(w, h) {
  const stageCY = h * HDR_PAD + (h * STAGE - h * HDR_PAD) * 0.35
  const cx = w / 2, cy = stageCY, pts = []
  const bandH = h * STAGE - h * HDR_PAD
  const topY = cy - bandH * 0.38, botY = cy + bandH * 0.38
  const lipW = w * 0.36, bow = bandH * 0.14
  for (let t = 0; t <= 1; t += 0.005) {
    const a = Math.PI * t, s = Math.sin(a)
    pts.push({ x: cx + Math.cos(a) * lipW, y: topY + s * (botY - topY) * 0.55 - Math.sin(Math.PI * t) * bow * (1 - s * 0.6) })
  }
  for (let fy = topY; fy <= cy; fy += h * 0.018) {
    const prog = (fy - topY) / (cy - topY), hW = lipW * (1 - prog * 0.25)
    const bf = Math.sin(Math.PI * prog) * bow * (1 - prog)
    for (let fx = cx - hW; fx <= cx + hW; fx += w * 0.014) {
      const d = Math.abs(fx - cx) / hW
      if (d < 0.96) pts.push({ x: fx, y: fy - bf * (1 - d) })
    }
  }
  for (let fy = cy; fy <= botY; fy += h * 0.018) {
    const prog = (fy - cy) / (botY - cy)
    const hW = lipW * (1 - prog * 0.35) * (1 + Math.sin(Math.PI * prog) * 0.12)
    for (let fx = cx - hW; fx <= cx + hW; fx += w * 0.014)
      if (Math.abs(fx - cx) / hW < 0.94) pts.push({ x: fx, y: fy })
  }
  return pts
}

// ── open mouth oval (lip sync) ──
function mouthOpenPath(w, h, openness) {
  const stageCY = h * HDR_PAD + (h * STAGE - h * HDR_PAD) * 0.35
  const cx = w / 2, cy = stageCY, pts = []
  const bandH = h * STAGE - h * HDR_PAD
  const lipW = w * 0.28, lipH = bandH * (0.10 + openness * 0.30)
  const topY = cy - bandH * 0.30
  for (let i = 0; i <= 80; i++) {
    const a = (i / 80) * Math.PI * 2
    pts.push({ x: cx + Math.cos(a) * lipW, y: topY + lipH + Math.sin(a) * lipH })
  }
  for (let fy = topY; fy <= topY + lipH * 2; fy += bandH * 0.038) {
    const prog = (fy - topY) / (lipH * 2)
    const hw = lipW * Math.sqrt(Math.max(0, 1 - (prog * 2 - 1) ** 2)) * 0.95
    for (let fx = cx - hw; fx <= cx + hw; fx += w * 0.016)
      pts.push({ x: fx, y: fy })
  }
  return pts
}

export default function SFParticleField({ bass = 0, treble = 0, isPlaying = false, morphToLips = false, mouthOpen = 0 }) {
  const canvasRef = useRef(null)
  const hostRef   = useRef(null)
  const liveRef   = useRef({ bass, treble, isPlaying, morphToLips, mouthOpen })
  const stateRef  = useRef({ particles: [], dust: [], stars: [], morph: 0, mouthProgress: 0, shockwaves: [] })
  const ptrsRef   = useRef(new Map())

  useEffect(() => { liveRef.current = { bass, treble, isPlaying, morphToLips, mouthOpen } })

  useEffect(() => {
    const canvas = canvasRef.current, host = hostRef.current
    if (!canvas || !host) return
    const ctx = canvas.getContext('2d')
    let raf = 0, w = 0, h = 0, lipsCache = []

    // ── Fibonacci sphere — 3D orb in the stage band ──
    function buildParticles() {
      const st = stateRef.current
      st.particles = []
      const openCache = mouthOpenPath(w, h, 0.5)
      const spCX = w / 2
      const spCY = h * HDR_PAD + (h * STAGE - h * HDR_PAD) * 0.35
      const rMax = Math.min(w * 0.20, (h * (STAGE - HDR_PAD)) * 0.42)
      const count = Math.min(lipsCache.length, 1800)

      for (let i = 0; i < count; i++) {
        // uniform Fibonacci sphere distribution
        const phi0   = Math.acos(1 - 2 * (i + 0.5) / count)
        const theta0 = Math.PI * (1 + Math.sqrt(5)) * i
        const r3d = rMax * (0.55 + Math.random() * 0.45)

        const lip  = lipsCache[i % lipsCache.length]
        const open = openCache[i % openCache.length]
        const depth = (1 + Math.cos(phi0)) / 2

        const initX = spCX + Math.sin(phi0) * Math.cos(theta0) * r3d
        const initY = spCY + Math.cos(phi0) * r3d * 0.58

        st.particles.push({
          x: initX + (Math.random() - 0.5) * 50,
          y: initY + (Math.random() - 0.5) * 50,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          hxLip: lip.x,   hyLip: lip.y,
          hxOpen: open.x, hyOpen: open.y,
          theta0, phi0, r3d,
          life: Math.random(),
          r: 0.5 + depth * 1.6,
          depth,
          phase: Math.random() * Math.PI * 2,
          flash: 0,
          speed: 0,
        })
      }
    }

    function buildDust() {
      const st = stateRef.current
      st.dust = []
      const n = Math.floor(w * h / 2400)
      const palettes = [
        [212, 166,  79], [255, 210,  90], [255, 155,  55],
        [255, 255, 240], [255, 120,  70], [190, 110,  35],
      ]
      for (let i = 0; i < n; i++) {
        const c = palettes[Math.floor(Math.random() * palettes.length)]
        st.dust.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.14 - 0.06,
          r: 0.25 + Math.random() * 0.7, opacity: 0.03 + Math.random() * 0.09,
          phase: Math.random() * Math.PI * 2,
          cr: c[0], cg: c[1], cb: c[2],
        })
      }
    }

    function buildStars() {
      stateRef.current.stars = Array.from({ length: 200 }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: 0.2 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
        speed: 0.005 + Math.random() * 0.012,
      }))
    }

    function resize() {
      const rect = host.getBoundingClientRect()
      w = Math.max(320, Math.floor(rect.width))
      h = Math.max(120, Math.floor(rect.height))
      canvas.width = w; canvas.height = h
      lipsCache = lipsPath(w, h)
      buildParticles(); buildDust(); buildStars()
    }

    // ── render loop ──
    function render() {
      const { bass: b, isPlaying: ip, morphToLips: ml, mouthOpen: mo } = liveRef.current
      const st  = stateRef.current
      const t   = performance.now() / 1000
      const ptrs    = [...ptrsRef.current.values()]
      const touching = ptrs.length > 0

      const morphTarget = ml ? 1 : 0
      const morphSpeed  = morphTarget > st.morph ? 0.04 : 0.10
      st.morph += (morphTarget - st.morph) * morphSpeed
      const morph = st.morph
      st.mouthProgress += (mo - st.mouthProgress) * 0.18
      const mouth = st.mouthProgress

      ctx.fillStyle = 'rgba(0,0,0,0.80)'
      ctx.fillRect(0, 0, w, h)

      const pulse = ip ? 0.45 + b * 1.5 : 0.08 + morph * 0.06

      // ── starfield ──
      ctx.fillStyle = 'rgb(255,248,230)'
      for (const s of st.stars) {
        s.phase += s.speed
        const alpha = Math.max(0, (0.05 + Math.sin(s.phase) * 0.18) * (ip ? 1 + b * 0.3 : 0.25))
        ctx.globalAlpha = Math.min(1, alpha)
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1

      // ── drain speaker tap sparks ──
      if (window.__sfSpark?.length) {
        const rect = canvas.getBoundingClientRect()
        for (const pt of window.__sfSpark) {
          const lx = pt.x - rect.left, ly = pt.y - rect.top
          st.shockwaves.push({ x: lx, y: ly, r: 6, speed: 4, opacity: 0.85 })
          for (const p of st.particles) {
            const dx = p.x - lx, dy = p.y - ly
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            if (dist < 120) {
              const force = 320 / Math.max(18, dist)
              p.vx += (dx / dist) * force * (0.5 + Math.random() * 1.0)
              p.vy += (dy / dist) * force * (0.5 + Math.random() * 1.0)
              p.flash = Math.max(p.flash, 1 - dist / 120)
              p.life  = Math.max(0.05, p.life - 0.35)
            }
          }
        }
        window.__sfSpark = []
      }

      // ── shockwave rings ──
      for (let i = st.shockwaves.length - 1; i >= 0; i--) {
        const sw = st.shockwaves[i]
        sw.r += sw.speed; sw.speed *= 1.04; sw.opacity -= 0.025
        if (sw.opacity <= 0) { st.shockwaves.splice(i, 1); continue }
        ctx.beginPath(); ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(255,255,255,${sw.opacity.toFixed(3)})`
        ctx.lineWidth = 1.2 + sw.opacity * 2; ctx.stroke()
        ctx.beginPath(); ctx.arc(sw.x, sw.y, sw.r * 0.7, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(212,166,79,${(sw.opacity * 0.7).toFixed(3)})`
        ctx.lineWidth = 0.7; ctx.stroke()
      }

      // ── ambient dust ──
      for (const d of st.dust) {
        d.phase += 0.007
        const flowAngle = Math.sin(d.x * 0.0028 + t * 0.16) * Math.cos(d.y * 0.0028 + t * 0.11) * Math.PI * 2
        d.x += d.vx + Math.cos(flowAngle) * 0.09 + Math.sin(d.phase) * 0.10
        d.y += d.vy + Math.sin(flowAngle) * 0.09 + Math.cos(d.phase * 0.7) * 0.08
        if (d.x < 0) d.x = w; if (d.x > w) d.x = 0
        if (d.y < 0) d.y = h; if (d.y > h) d.y = 0
        ctx.globalAlpha = Math.min(1, d.opacity * (ip ? 1 + b * 1.1 : 0.55) * (touching ? 0.35 : 1))
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgb(${d.cr},${d.cg},${d.cb})`; ctx.fill()
      }
      ctx.globalAlpha = 1

      // ── 3D sphere → Shady lips particle system ──
      const spCX = w / 2
      const spCY = h * HDR_PAD + (h * STAGE - h * HDR_PAD) * 0.35
      const rot   = t * 0.22                          // slow y-axis rotation
      const bassR = 1 + (ip ? b * 0.30 : 0)          // sphere breathes with bass

      for (const p of st.particles) {
        // sphere home — rotates in real-time
        const px3 = Math.sin(p.phi0) * Math.cos(p.theta0 + rot) * p.r3d * bassR
        const py3 = Math.cos(p.phi0) * p.r3d * 0.58 * bassR
        const pz3 = Math.sin(p.phi0) * Math.sin(p.theta0 + rot) * p.r3d
        const targXSf = spCX + px3
        const targYSf = spCY + py3

        // wave only in lip mode
        const waveAmt = touching ? 0.2 : (morph > 0.08 ? morph * 0.8 : 0)
        const wave = Math.sin(t * 1.5 + p.phase) * waveAmt

        // three-way blend: sphere → closed lips → open mouth
        const lipsX = p.hxLip + (p.hxOpen - p.hxLip) * mouth
        const lipsY = p.hyLip + (p.hyOpen - p.hyLip) * mouth
        const targX = targXSf + (lipsX - targXSf) * morph + wave * (1 - morph)
        const targY = targYSf + (lipsY - targYSf) * morph

        // z-depth: front(pz>0)=1, back(pz<0)=0
        const zDepth = (pz3 / (p.r3d + 0.001) + 1) * 0.5

        // spring toward home
        const dx = targX - p.x, dy = targY - p.y
        const inSphereMode = morph < 0.1
        const homeStr = touching
          ? 0.005 + pulse * 0.002
          : inSphereMode
            ? 0.040 + (1 - p.life) * 0.02
            : 0.016 + pulse * 0.005 + (1 - p.life) * 0.01
        const noise = inSphereMode ? 0.012 : 0.045
        p.vx += dx * homeStr + (Math.random() - 0.5) * noise
        p.vy += dy * homeStr + (Math.random() - 0.5) * noise

        // pointer repulsion
        for (const ptr of ptrs) {
          const ex = p.x - ptr.x, ey = p.y - ptr.y
          const dist2 = ex * ex + ey * ey
          if (dist2 < 1) continue
          const dist = Math.sqrt(dist2)
          const mag = Math.min(280, 9000 / (dist2 + 1)) + (dist < 160 ? (160 - dist) / 160 * 0.8 : 0)
          p.vx += (ex / dist) * mag * 0.14
          p.vy += (ey / dist) * mag * 0.14
          if (dist < 40) p.flash = Math.max(p.flash, 0.9 * (1 - dist / 40))
        }

        const damp = inSphereMode ? 0.80 : 0.88
        p.vx *= damp; p.vy *= damp
        p.x  += p.vx; p.y  += p.vy
        p.speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
        if (!touching) p.life = Math.min(1, p.life + 0.014)
        if (p.flash > 0) p.flash -= 0.06

        // color: white sphere → Shady red lips
        const speedFactor = Math.min(1, p.speed / 8)
        let pR = 255 + (255 - 255) * morph
        let pG = 255 + ( 20 - 255) * morph
        let pB = 255 + ( 20 - 255) * morph
        pR = pR + (255 - pR) * speedFactor * 0.7
        pG = pG + (255 - pG) * speedFactor * 0.85
        pB = pB + (255 - pB) * speedFactor
        ctx.fillStyle = `rgb(${Math.round(pR)},${Math.round(pG)},${Math.round(pB)})`

        if (inSphereMode) {
          // 3D depth rendering: front bright, back dim — hollow orb illusion
          const isFront = pz3 >= 0
          const sz = 0.5 + zDepth * 1.1 + (ip ? b * 0.5 : 0) + p.flash * 1.5
          ctx.globalAlpha = Math.min(1, (isFront ? 0.45 + zDepth * 0.50 : 0.08 + zDepth * 0.10) + p.flash * 0.4)
          ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill()
          // bloom only on front-facing particles
          if (isFront) {
            ctx.globalAlpha = Math.min(1, 0.08 + zDepth * 0.12 + (ip ? b * 0.10 : 0))
            ctx.beginPath(); ctx.arc(p.x, p.y, sz * 3.0, 0, Math.PI * 2); ctx.fill()
          }
          ctx.globalAlpha = 1
        } else {
          // lips mode: full bloom glow
          const depth     = 0.30 + p.depth * 0.70
          const alpha     = (0.05 + p.life * 0.70) * depth + p.flash * 0.4 + speedFactor * 0.3
          const coreAlpha = Math.min(1, alpha + 0.18 + p.flash * 0.5)
          const glowR = p.r * (2.5 + pulse * 2 + speedFactor * 4) * p.depth
          if (glowR > 0.5 && alpha > 0.02) {
            ctx.globalAlpha = Math.min(1, alpha * 0.28)
            ctx.beginPath(); ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2); ctx.fill()
            ctx.globalAlpha = Math.min(1, alpha * 0.08)
            ctx.beginPath(); ctx.arc(p.x, p.y, glowR * 1.7, 0, Math.PI * 2); ctx.fill()
            ctx.globalAlpha = 1
          }
          const coreSize = p.r + pulse * 0.4 * p.life + speedFactor * 1.2 + p.flash * 1.5
          ctx.globalAlpha = coreAlpha
          ctx.beginPath(); ctx.arc(p.x, p.y, coreSize, 0, Math.PI * 2); ctx.fill()
          ctx.globalAlpha = 1
          if (speedFactor > 0.25) {
            ctx.beginPath()
            ctx.arc(p.x - p.vx * 2, p.y - p.vy * 2, coreSize * 0.4, 0, Math.PI * 2)
            ctx.fillStyle = `rgba(${Math.round(pR)},${Math.round(pG)},${Math.round(pB)},${(coreAlpha * 0.25).toFixed(3)})`
            ctx.fill()
          }
        }
      }

      raf = requestAnimationFrame(render)
    }

    resize()
    render()

    const ro = new ResizeObserver(resize)
    ro.observe(host)

    function getLocal(e) {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    function onDown(e) {
      canvas.setPointerCapture(e.pointerId)
      const pos = getLocal(e)
      ptrsRef.current.set(e.pointerId, pos)
    }
    function onMove(e) {
      if (ptrsRef.current.has(e.pointerId)) ptrsRef.current.set(e.pointerId, getLocal(e))
    }
    function onUp(e) { ptrsRef.current.delete(e.pointerId) }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup',   onUp)
    canvas.addEventListener('pointercancel', onUp)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup',   onUp)
      canvas.removeEventListener('pointercancel', onUp)
    }
  }, [])

  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
        className="ss-particle-canvas"
      />
    </div>
  )
}
