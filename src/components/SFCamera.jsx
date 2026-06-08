import { useEffect, useRef, useState } from 'react'

export default function SFCamera({ active, onMotion }) {
  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const prevBufRef  = useRef(null)   // reuse buffer — no per-frame alloc
  const [granted, setGranted] = useState(false)

  useEffect(() => {
    if (!active) return
    let stream = null, raf = 0

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
          audio: false,
        })
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        video.play()
        setGranted(true)

        function drawFrame() {
          raf = requestAnimationFrame(drawFrame)
          const canvas = canvasRef.current
          if (!canvas || !video || video.readyState < 2) return
          const ctx = canvas.getContext('2d')
          const w = canvas.offsetWidth || 320
          const h = canvas.offsetHeight || 240
          canvas.width = w; canvas.height = h

          // mirror + dark + desaturate for ghostly effect
          ctx.save()
          ctx.translate(w, 0); ctx.scale(-1, 1)
          ctx.drawImage(video, 0, 0, w, h)
          ctx.restore()

          // darken overlay — camera is barely visible, particles float on top
          ctx.fillStyle = 'rgba(0,0,0,0.62)'
          ctx.fillRect(0, 0, w, h)

          // motion detection — reuse buffer to avoid per-frame allocation
          const frame = ctx.getImageData(0, 0, w, h)
          if (prevBufRef.current && prevBufRef.current.length === frame.data.length && onMotion) {
            let diff = 0
            for (let i = 0; i < frame.data.length; i += 16)
              diff += Math.abs(frame.data[i] - prevBufRef.current[i])
            const motionLevel = Math.min(1, diff / (w * h * 0.4))
            if (motionLevel > 0.015) onMotion(motionLevel)
          }
          if (!prevBufRef.current || prevBufRef.current.length !== frame.data.length)
            prevBufRef.current = new Uint8ClampedArray(frame.data.length)
          prevBufRef.current.set(frame.data)
        }
        drawFrame()
      } catch {
        setGranted(false)
      }
    }

    start()
    return () => {
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [active])

  if (!active) return null

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 1, overflow: 'hidden' }}>
      <video ref={videoRef} muted playsInline
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0 }} />
      <canvas ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {!granted && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: 'rgba(212,166,79,0.3)',
          fontFamily: 'monospace', fontSize: '0.55rem', letterSpacing: '0.2em', textTransform: 'uppercase'
        }}>
          tap to enable camera
        </div>
      )}
    </div>
  )
}
