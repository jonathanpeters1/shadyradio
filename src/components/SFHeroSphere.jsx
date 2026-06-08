import { useEffect, useRef } from 'react'

export default function SFHeroSphere({ bass = 0, treble = 0, isPlaying = false }) {
  const canvasRef = useRef(null)
  const liveRef = useRef({ bass, treble, isPlaying })

  useEffect(() => {
    liveRef.current = { bass, treble, isPlaying }
  })

  useEffect(() => {
    let raf = 0
    let mounted = true
    let cleanup = null

    function tryInit() {
      const THREE = window.THREE
      if (!THREE || !mounted) {
        if (mounted) setTimeout(tryInit, 80)
        return
      }

      const canvas = canvasRef.current
      if (!canvas) return

      const w = canvas.offsetWidth || 300
      const h = canvas.offsetHeight || 200

      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(w, h, false)
      renderer.setClearColor(0x000000, 0)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 50)
      camera.position.set(0, 0, 5.0)

      const R = 1.35

      // Core sphere
      const coreGeo = new THREE.SphereGeometry(R, 64, 64)
      const coreMat = new THREE.MeshStandardMaterial({
        color: 0x0d0405,
        emissive: new THREE.Color(0xff6b35),
        emissiveIntensity: 0.38,
        metalness: 0.25,
        roughness: 0.52,
        transparent: true,
        opacity: 0.93,
      })
      const core = new THREE.Mesh(coreGeo, coreMat)
      scene.add(core)

      // Inner iridescent layer
      const innerGeo = new THREE.SphereGeometry(R * 0.96, 32, 32)
      const innerMat = new THREE.MeshStandardMaterial({
        color: 0x1a0510,
        emissive: new THREE.Color(0x9944ff),
        emissiveIntensity: 0.14,
        metalness: 0.8,
        roughness: 0.2,
        transparent: true,
        opacity: 0.35,
        side: THREE.BackSide,
      })
      scene.add(new THREE.Mesh(innerGeo, innerMat))

      // Wireframe shell
      const wireGeo = new THREE.SphereGeometry(R * 1.038, 28, 28)
      const wireMat = new THREE.MeshBasicMaterial({
        color: 0xff8844,
        wireframe: true,
        transparent: true,
        opacity: 0.10,
      })
      const wireShell = new THREE.Mesh(wireGeo, wireMat)
      scene.add(wireShell)

      // Outer glow
      const glowGeo = new THREE.SphereGeometry(R * 1.30, 24, 24)
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xff9944,
        transparent: true,
        opacity: 0.07,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
      })
      scene.add(new THREE.Mesh(glowGeo, glowMat))

      // Wide halo
      const haloGeo = new THREE.SphereGeometry(R * 1.65, 16, 16)
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0xff6622,
        transparent: true,
        opacity: 0.03,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
      })
      scene.add(new THREE.Mesh(haloGeo, haloMat))

      // Orbiting particle cloud
      const PTS = 320
      const ptPos = new Float32Array(PTS * 3)
      for (let i = 0; i < PTS; i++) {
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(2 * Math.random() - 1)
        const r = R * (1.40 + Math.random() * 0.65)
        ptPos[i * 3]     = r * Math.sin(phi) * Math.cos(theta)
        ptPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
        ptPos[i * 3 + 2] = r * Math.cos(phi)
      }
      const ptGeo = new THREE.BufferGeometry()
      ptGeo.setAttribute('position', new THREE.BufferAttribute(ptPos, 3))
      const ptMat = new THREE.PointsMaterial({
        color: 0xffaa55,
        size: 0.020,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const particleCloud = new THREE.Points(ptGeo, ptMat)
      scene.add(particleCloud)

      // Lights
      scene.add(new THREE.AmbientLight(0xffffff, 0.26))
      const keyLight = new THREE.PointLight(0xff7733, 2.6, 14)
      keyLight.position.set(2.5, 2, 3)
      scene.add(keyLight)
      const fillLight = new THREE.PointLight(0xaa44ff, 0.7, 10)
      fillLight.position.set(-2.5, -1.5, 2)
      scene.add(fillLight)
      const rimLight = new THREE.PointLight(0x00ccff, 0.4, 8)
      rimLight.position.set(0, -3, -2)
      scene.add(rimLight)

      // Drag / spin interaction
      let dragging = false
      let prevX = 0, prevY = 0
      let velX = 0, velY = 0

      const onDown = (e) => {
        dragging = true
        prevX = e.clientX; prevY = e.clientY
        velX = velY = 0
        canvas.setPointerCapture(e.pointerId)
      }
      const onMove = (e) => {
        if (!dragging) return
        const dx = e.clientX - prevX
        const dy = e.clientY - prevY
        velX = dx * 0.013; velY = dy * 0.013
        core.rotation.y      += velX
        core.rotation.x      += velY
        wireShell.rotation.y += velX * 0.65
        wireShell.rotation.x += velY * 0.65
        prevX = e.clientX; prevY = e.clientY
      }
      const onUp = () => { dragging = false }

      canvas.addEventListener('pointerdown', onDown)
      canvas.addEventListener('pointermove', onMove)
      canvas.addEventListener('pointerup', onUp)
      canvas.addEventListener('pointerleave', onUp)

      const onResize = () => {
        const nw = canvas.offsetWidth || 300
        const nh = canvas.offsetHeight || 200
        renderer.setSize(nw, nh, false)
        camera.aspect = nw / nh
        camera.updateProjectionMatrix()
      }
      window.addEventListener('resize', onResize)

      let t = 0
      function tick() {
        if (!mounted) return
        raf = requestAnimationFrame(tick)
        t += 0.016

        const { bass: b, isPlaying: ip } = liveRef.current
        const pulse = ip ? 1 + b * 0.18 : 1 + Math.sin(t * 0.75) * 0.012

        if (!dragging) {
          velX *= 0.93
          velY *= 0.93
          core.rotation.y      += velX + 0.0022
          core.rotation.x      += velY * 0.4
          wireShell.rotation.y -= 0.0038
          wireShell.rotation.x += 0.0015
        }

        core.scale.setScalar(pulse)
        coreMat.emissiveIntensity = 0.30 + b * 0.55
        keyLight.intensity = 2.2 + b * 2.0
        ptMat.opacity = 0.52 + b * 0.40
        particleCloud.rotation.y += 0.0014
        particleCloud.rotation.z += 0.0007

        renderer.render(scene, camera)
      }
      tick()

      cleanup = () => {
        canvas.removeEventListener('pointerdown', onDown)
        canvas.removeEventListener('pointermove', onMove)
        canvas.removeEventListener('pointerup', onUp)
        canvas.removeEventListener('pointerleave', onUp)
        window.removeEventListener('resize', onResize)
        cancelAnimationFrame(raf)
        renderer.dispose()
        coreGeo.dispose(); coreMat.dispose()
        innerGeo.dispose(); innerMat.dispose()
        wireGeo.dispose(); wireMat.dispose()
        glowGeo.dispose(); glowMat.dispose()
        haloGeo.dispose(); haloMat.dispose()
        ptGeo.dispose(); ptMat.dispose()
      }
    }

    tryInit()
    return () => {
      mounted = false
      cancelAnimationFrame(raf)
      cleanup?.()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab', touchAction: 'none' }}
    />
  )
}
