import React from 'react'
import audioManager from '../audio/audioManager'

export default function DiagPanel({
  meters,
  activeChannel,
  pendingChannel,
  crossfadeProgress,
  activeBpm,
  shadowChannels,
  onClose
}) {
  // Only render in development builds
  if (!import.meta.env.DEV) return null

  const ctxState = audioManager.audioContext?.state || 'none'
  const wasmReady = audioManager.wasmReady
  const workletConnected = audioManager.workletNode ? 'connected' : 'none'

  // Status indicators
  const statusDot = (ok) => (
    <span style={{
      display: 'inline-block',
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      background: ok ? '#22c55e' : '#ef4444',
      marginRight: '4px'
    }} />
  )

  // Format channel state
  const getChannelState = (i) => {
    if (i === activeChannel) return { label: 'active', color: '#22c55e' }
    if (shadowChannels.includes(i)) return { label: 'shadow', color: '#d4a64f' }
    return { label: 'silent', color: '#6b7280' }
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: '1rem',
      left: '1rem',
      zIndex: 200,
      background: 'rgba(0,0,0,0.93)',
      border: '1px solid rgba(212,166,79,0.3)',
      padding: '0.8rem',
      borderRadius: '6px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
      fontSize: '0.42rem',
      color: 'rgba(255,255,255,0.7)',
      minWidth: '220px',
      maxHeight: '70vh',
      overflowY: 'auto',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
    }}>
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '0.4rem',
          right: '0.4rem',
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.5)',
          fontSize: '0.5rem',
          cursor: 'pointer',
          padding: '0.1rem 0.3rem'
        }}
      >
        ×
      </button>

      <h3 style={{ margin: '0 0 0.5rem 0', color: '#d4a64f', fontSize: '0.5rem' }}>
        SF DIAGNOSTIC
      </h3>

      {/* AUDIO ENGINE */}
      <section style={{ marginBottom: '0.6rem' }}>
        <div style={{ color: '#9ca3af', marginBottom: '0.2rem', fontSize: '0.38rem' }}>
          AUDIO ENGINE
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>AudioContext:</span>
          <span>{statusDot(ctxState === 'running')}{ctxState}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>WASM:</span>
          <span>{statusDot(wasmReady)}{wasmReady ? 'ready' : 'loading'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>WorkletNode:</span>
          <span>{statusDot(workletConnected === 'connected')}{workletConnected}</span>
        </div>
      </section>

      {/* CHANNELS */}
      <section style={{ marginBottom: '0.6rem' }}>
        <div style={{ color: '#9ca3af', marginBottom: '0.2rem', fontSize: '0.38rem' }}>
          CHANNELS
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.38rem' }}>
          <thead>
            <tr style={{ color: '#6b7280' }}>
              <th style={{ textAlign: 'left', paddingRight: '0.3rem' }}>CH</th>
              <th style={{ textAlign: 'left', paddingRight: '0.3rem' }}>STATE</th>
              <th style={{ textAlign: 'right', paddingRight: '0.3rem' }}>BPM</th>
              <th style={{ textAlign: 'right' }}>PHRASE</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 16 }, (_, i) => {
              const state = getChannelState(i)
              const bpm = meters[12 + i] // meters[12-27] are channel BPMs
              const phrase = meters[28 + i] // meters[28-43] are phrase phases
              return (
                <tr key={i}>
                  <td style={{ paddingRight: '0.3rem', color: '#6b7280' }}>
                    {String(i + 1).padStart(2, '0')}
                  </td>
                  <td style={{ paddingRight: '0.3rem', color: state.color }}>
                    {state.label}
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: '0.3rem' }}>
                    {bpm > 0 ? Math.round(bpm) : '---'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {phrase > 0 ? phrase.toFixed(2) : '---'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {/* AUTOMIX */}
      <section style={{ marginBottom: '0.6rem' }}>
        <div style={{ color: '#9ca3af', marginBottom: '0.2rem', fontSize: '0.38rem' }}>
          AUTOMIX
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Active ch:</span>
          <span>{activeChannel >= 0 ? String(activeChannel + 1).padStart(2, '0') : '---'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Pending ch:</span>
          <span>{pendingChannel >= 0 ? String(pendingChannel + 1).padStart(2, '0') : '---'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Xfade:</span>
          <span>{(crossfadeProgress * 100).toFixed(0)}%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Active BPM:</span>
          <span>{activeBpm > 0 ? activeBpm.toFixed(1) : '---'}</span>
        </div>
      </section>

      {/* METERS */}
      <section style={{ marginBottom: '0.6rem' }}>
        <div style={{ color: '#9ca3af', marginBottom: '0.2rem', fontSize: '0.38rem' }}>
          METERS (raw)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.15rem', fontSize: '0.35rem' }}>
          {meters.map((v, i) => (
            <div key={i} style={{ textAlign: 'right', color: v > 0 ? '#d4a64f' : '#6b7280' }}>
              {v.toFixed(2)}
            </div>
          ))}
        </div>
      </section>

      {/* MEMORY */}
      {performance.memory && (
        <section>
          <div style={{ color: '#9ca3af', marginBottom: '0.2rem', fontSize: '0.38rem' }}>
            MEMORY
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.38rem' }}>
            <span>JS Heap:</span>
            <span>{(performance.memory.usedJSHeapSize / 1048576).toFixed(1)} MB</span>
          </div>
        </section>
      )}
    </div>
  )
}
