import React from 'react'
import './Library.css'

function Library() {
  return (
    <div className="library">
      <div className="library-container">
        <h1 className="library-title">Library</h1>
        <div className="empty-state">
          <div className="empty-icon">📚</div>
          <h2>No tracks imported yet</h2>
          <p>Your music library will appear here</p>
          <button className="import-btn">Import from AUTOSYNCED</button>
        </div>
      </div>
    </div>
  )
}

export default Library