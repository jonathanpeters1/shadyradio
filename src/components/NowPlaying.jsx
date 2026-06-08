import React, { useState, useEffect } from 'react'
import { useAudio } from '../hooks/useAudio'
import './NowPlaying.css'

function NowPlaying() {
  const { isPlaying, isCrossfading, duration, currentTime, bpm, isLoaded, initialize, loadFile, play, pause, resume, stop, crossfadeTo } = useAudio();
  const [selectedFile, setSelectedFile] = useState(null);
  const [nextFile, setNextFile] = useState(null);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        await loadFile(file);
        setSelectedFile(file.name);
      } catch (error) {
        alert('Failed to load audio file');
      }
    }
  };

  const handleNextFileSelect = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const buffer = await loadFile(file);
        setNextFile(file.name);
        if (isPlaying) {
          crossfadeTo(buffer);
        }
      } catch (error) {
        alert('Failed to load next audio file');
      }
    }
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  return (
    <div className="now-playing">
      <div className="now-playing-container">
        {/* Album Artwork */}
        <div className="artwork">
          <div className="artwork-placeholder">
            <img src="/woofer.png" alt="speaker" className={`speaker-image-large ${isCrossfading ? 'crossfading' : ''}`} />
          </div>
        </div>

        {/* Track Info */}
        <div className="track-info">
          <h2 className="track-title">{selectedFile || 'No Track Playing'}</h2>
          <p className="track-artist">
            {bpm > 0 ? `${bpm} BPM` : ''}
            {duration > 0 && ` • ${duration.toFixed(1)}s`}
            {isCrossfading && ' • CROSSFADING'}
          </p>
        </div>

        {/* File Inputs */}
        <div className="file-inputs">
          <div className="file-input">
            <input 
              type="file" 
              accept="audio/*"
              onChange={handleFileSelect}
              id="audio-input"
              style={{ display: 'none' }}
            />
            <label htmlFor="audio-input" className="file-label">
              📁 Current Track
            </label>
          </div>
          
          <div className="file-input">
            <input 
              type="file" 
              accept="audio/*"
              onChange={handleNextFileSelect}
              id="next-input"
              style={{ display: 'none' }}
            />
            <label htmlFor="next-input" className="file-label">
              📁 Next Track (Crossfade)
            </label>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="playback-controls">
          <button className="control-btn" onClick={stop}>
            ⏮️
          </button>
          <button 
            className="play-btn" 
            onClick={handlePlayPause}
            disabled={!isLoaded}
          >
            {isPlaying ? '⏸️' : '▶️'}
          </button>
          <button className="control-btn">
            ⏭️
          </button>
        </div>
      </div>
    </div>
  )
}

export default NowPlaying