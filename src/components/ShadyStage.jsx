import { useEffect, useRef, useState } from 'react'
import './ShadyStage.css'

// words that pop BIG in gold
const FIRE_WORDS = new Set([
  'girl','girls','honey','baby','bitch','werk','work','queen','mama',
  'please','excuse','chile','child','sis','sister','damn','lord',
  'okay','ok','yes','no','stop','wait','really','seriously',
])
// words that slam red + particle burst
const SNAP_WORDS = new Set([
  'snap','period','periodt','done','finished','bye','goodbye','later',
  'iconic','legendary','stunning','gorgeous','amazing','fire',
])
// words that get the fan-wave (italic gold slide)
const SHADE_WORDS = new Set([
  'anyway','moving','next','whatever','sure','right','sure','interesting',
  'oh','hmm','mmm','well','so','but','because',
])

let wordId = 0

export default function ShadyStage({ reply, isActive, stageRef }) {
  const [words, setWords]   = useState([])
  const timersRef = useRef([])

  useEffect(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    if (!reply || !isActive) { setWords([]); return }

    const tokens = reply.match(/[^\s,!?.]+[!?.]?/g) || []
    let delay = 0

    tokens.forEach((raw, i) => {
      const clean = raw.toLowerCase().replace(/[^a-z]/g, '')
      const isSnap = SNAP_WORDS.has(clean)
      const isFire = FIRE_WORDS.has(clean)
      const isShade = SHADE_WORDS.has(clean)
      const kind = isSnap ? 'snap' : isFire ? 'fire' : isShade ? 'shade' : 'normal'

      // skip tiny filler words for normal tier
      if (kind === 'normal' && clean.length <= 2) return
      // stagger timing — fire/snap words get extra pause before
      if (isSnap || isFire) delay += 60

      const t = setTimeout(() => {
        // fire sparkle burst for snap words
        if (isSnap && stageRef?.current) {
          const rect = stageRef.current.getBoundingClientRect()
          const cx = rect.left + rect.width / 2
          const cy = rect.top  + rect.height * 0.5
          if (!window.__sfSpark) window.__sfSpark = []
          // multiple burst points
          for (let k = 0; k < 5; k++) {
            window.__sfSpark.push({
              x: cx + (Math.random() - 0.5) * rect.width * 0.5,
              y: cy + (Math.random() - 0.5) * rect.height * 0.5,
            })
          }
        }

        const id = ++wordId
        // position: keep words in stage band, avoid corners
        const xZone = 12 + Math.random() * 72
        const yZone = 18 + Math.random() * 58
        setWords(prev => {
          const next = [...prev, { id, text: raw.toUpperCase(), x: xZone, y: yZone, kind }]
          return next.slice(-8) // max 8 words on screen at once
        })

        // auto-remove after display time
        const life = isSnap ? 1100 : isFire ? 1500 : 1000
        const remove = setTimeout(() => {
          setWords(prev => prev.filter(w => w.id !== id))
        }, life)
        timersRef.current.push(remove)
      }, delay)

      timersRef.current.push(t)
      delay += isSnap ? 420 : isFire ? 340 : 240
    })

    return () => timersRef.current.forEach(clearTimeout)
  }, [reply, isActive])

  return (
    <div className="shady-stage">
      {words.map(w => (
        <span
          key={w.id}
          className={`shady-word shady-word--${w.kind}`}
          style={{ left: `${w.x}%`, top: `${w.y}%` }}
        >
          {w.text}
        </span>
      ))}
    </div>
  )
}
