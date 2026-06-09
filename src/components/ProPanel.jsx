import React from 'react'
import './ProPanel.css'

export default function ProPanel({
  isOpen,
  channels,
  channelGains,
  channelEQs,
  activeChannel,
  onGainChange,
  onEQChange,
  onClose
}) {
  // Genre abbreviations (2-3 chars)
  const abbrev = (name) => {
    const words = name.split(' ')
    if (words.length === 1) return name.slice(0, 3).toUpperCase()
    return words.map(w => w[0]).join('').toUpperCase().slice(0, 3)
  }

  const activeEQ = channelEQs[activeChannel] || { low: 0, mid: 0, high: 0 }
  const activeGenre = channels[activeChannel]

  return (
    <div className={`pro-panel ${isOpen ? 'pro-panel--open' : ''}`}>
      <div className="pro-panel__header">
        <span className="pro-panel__title">MIXER</span>
        <button className="pro-panel__close" onClick={onClose}>×</button>
      </div>

      {/* TOP SECTION: 16-channel gain strip */}
      <div className="pro-panel__gain-strip">
        {channels.map((ch, i) => (
          <div
            key={ch.slug}
            className={`pro-panel__channel ${i === activeChannel ? 'pro-panel__channel--active' : ''}`}
          >
            <span className="pro-panel__ch-num">{String(i + 1).padStart(2, '0')}</span>
            <span className="pro-panel__ch-name">{abbrev(ch.name)}</span>
            <input
              type="range"
              min="-20"
              max="6"
              step="0.5"
              value={channelGains[i]}
              onChange={(e) => onGainChange(i, parseFloat(e.target.value))}
              className="pro-panel__fader"
              orient="vertical"
            />
            <span className="pro-panel__ch-db">{channelGains[i].toFixed(1)}dB</span>
          </div>
        ))}
      </div>

      {/* BOTTOM SECTION: EQ detail for active channel */}
      <div className="pro-panel__eq-section">
        <div className="pro-panel__eq-header">
          CH {String(activeChannel + 1).padStart(2, '0')} — {activeGenre?.name || 'OFF'}
        </div>
        <div className="pro-panel__eq-knobs">
          <div className="pro-panel__eq-row">
            <span className="pro-panel__eq-label">LOW</span>
            <input
              type="range"
              min="-12"
              max="6"
              step="0.5"
              value={activeEQ.low}
              onChange={(e) => onEQChange(activeChannel, { ...activeEQ, low: parseFloat(e.target.value) })}
              className="pro-panel__eq-slider"
            />
            <span className="pro-panel__eq-value">{activeEQ.low > 0 ? '+' : ''}{activeEQ.low.toFixed(1)}dB</span>
          </div>
          <div className="pro-panel__eq-row">
            <span className="pro-panel__eq-label">MID</span>
            <input
              type="range"
              min="-12"
              max="6"
              step="0.5"
              value={activeEQ.mid}
              onChange={(e) => onEQChange(activeChannel, { ...activeEQ, mid: parseFloat(e.target.value) })}
              className="pro-panel__eq-slider"
            />
            <span className="pro-panel__eq-value">{activeEQ.mid > 0 ? '+' : ''}{activeEQ.mid.toFixed(1)}dB</span>
          </div>
          <div className="pro-panel__eq-row">
            <span className="pro-panel__eq-label">HI</span>
            <input
              type="range"
              min="-12"
              max="6"
              step="0.5"
              value={activeEQ.high}
              onChange={(e) => onEQChange(activeChannel, { ...activeEQ, high: parseFloat(e.target.value) })}
              className="pro-panel__eq-slider"
            />
            <span className="pro-panel__eq-value">{activeEQ.high > 0 ? '+' : ''}{activeEQ.high.toFixed(1)}dB</span>
          </div>
        </div>
      </div>
    </div>
  )
}
