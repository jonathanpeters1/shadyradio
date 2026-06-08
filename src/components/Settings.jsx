import React from 'react'
import './Settings.css'

function Settings() {
  return (
    <div className="settings">
      <div className="settings-container">
        <h1 className="settings-title">Settings</h1>
        
        <div className="settings-section">
          <h2 className="section-title">Playback</h2>
          
          <div className="setting-item">
            <div className="setting-info">
              <label>Queue Mode</label>
              <p className="setting-description">How tracks are selected</p>
            </div>
            <select className="setting-select">
              <option>Sequential</option>
              <option>Random</option>
              <option>Harmonic</option>
            </select>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <label>Repeat Mode</label>
              <p className="setting-description">Loop behavior</p>
            </div>
            <select className="setting-select">
              <option>Off</option>
              <option>All</option>
              <option>One</option>
            </select>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <label>Harmonic Mixing</label>
              <p className="setting-description">Match musical keys</p>
            </div>
            <div className="toggle"></div>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <label>BPM Range Limits</label>
              <p className="setting-description">Smooth tempo transitions</p>
            </div>
            <div className="toggle active"></div>
          </div>
        </div>

        <div className="settings-section">
          <h2 className="section-title">Subscription</h2>
          
          <div className="setting-item">
            <div className="setting-info">
              <label>Current Plan</label>
              <p className="setting-description">Free tier</p>
            </div>
            <button className="upgrade-btn">Upgrade to Premium</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Settings