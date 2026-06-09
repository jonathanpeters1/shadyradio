import React, { useRef, useEffect } from 'react'
import audioManager from '../audio/audioManager'
import './SFSpectrum.css'

export default function SFSpectrum({ isPlaying }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const peaksRef = useRef(Array(48).fill(0))
  const holdCountersRef = useRef(Array(48).fill(0))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const analyser = audioManager.getSpectrumAnalyser()
    if (!analyser) return

    const bufferLength = analyser.frequencyBinCount // 1024 for fftSize=2048
    const dataArray = new Uint8Array(bufferLength)

    // Logarithmic bin distribution for 48 bars (focus on 0-4.3kHz, bins 0-200)
    const numBars = 48
    const maxBin = 200 // ~4.3kHz at 44.1kHz sample rate
    const binIndices = []
    for (let i = 0; i < numBars; i++) {
      const t = i / (numBars - 1)
      const logT = Math.pow(t, 2.5) // Logarithmic curve emphasizes bass
      binIndices.push(Math.floor(logT * maxBin))
    }

    function draw() {
      const width = canvas.width
      const height = canvas.height

      // Clear canvas (transparent)
      ctx.clearRect(0, 0, width, height)

      if (!isPlaying) {
        // Draw flat baseline when not playing
        ctx.fillStyle = 'rgba(212,166,79,0.12)'
        ctx.fillRect(0, height * 0.98, width, 1)
        rafRef.current = requestAnimationFrame(draw)
        return
      }

      // Get frequency data
      analyser.getByteFrequencyData(dataArray)

      const barWidth = width / numBars
      const gap = 2

      for (let i = 0; i < numBars; i++) {
        const binIndex = binIndices[i]
        const value = dataArray[binIndex] || 0
        const barHeight = (value / 255) * height * 0.9

        const x = i * barWidth + gap
        const y = height - barHeight
        const w = barWidth - gap * 2

        // Gradient based on height
        let color
        const heightRatio = barHeight / (height * 0.9)
        if (heightRatio < 0.4) {
          color = 'rgba(212,166,79,0.85)' // amber
        } else if (heightRatio < 0.8) {
          color = 'rgba(220,200,140,0.6)' // warm white
        } else {
          color = 'rgba(255,255,220,0.4)' // bright tip
        }

        // Draw bar
        ctx.fillStyle = color
        ctx.fillRect(x, y, w, barHeight)

        // Peak hold dot
        if (barHeight > peaksRef.current[i]) {
          peaksRef.current[i] = barHeight
          holdCountersRef.current[i] = 18
        } else if (holdCountersRef.current[i] > 0) {
          holdCountersRef.current[i]--
        } else {
          peaksRef.current[i] = Math.max(0, peaksRef.current[i] - 1)
        }

        const peakY = height - peaksRef.current[i]
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.fillRect(x, peakY - 1, w, 1)
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(rafRef.current)
    }
  }, [isPlaying])

  // Handle canvas resize
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * window.devicePixelRatio
      canvas.height = rect.height * window.devicePixelRatio
    }

    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  return (
    <div className="sf-spectrum">
      <canvas ref={canvasRef} />
    </div>
  )
}
