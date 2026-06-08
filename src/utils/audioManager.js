// Web Audio API implementation for Shady Radio with Beat-Synced Mixing Engine

class AudioManager {
  constructor() {
    this.audioContext = null;
    this.currentBuffer = null;
    this.nextBuffer = null;
    
    this.sourceA = null;
    this.sourceB = null;
    this.gainA = null;
    this.gainB = null;
    this.masterGain = null;
    
    this.isPlaying = false;
    this.crossfading = false;
    this.crossfadeDuration = 32; // 32 bars ~ 128s at 128 BPM - LONG SEXY MIX
    this.crossfadeTimer = null;
    
    // Beat sync
    this.currentBPM = 0;
    this.nextBPM = 0;
    this.beatGrid = [];
    this.nextBeatGrid = [];
  }

  async initialize() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Create gain nodes for crossfade
      this.gainA = this.audioContext.createGain();
      this.gainB = this.audioContext.createGain();
      this.masterGain = this.audioContext.createGain();
      
      // Connect: A & B → Master → Destination
      this.gainA.connect(this.masterGain);
      this.gainB.connect(this.masterGain);
      this.masterGain.connect(this.audioContext.destination);
      
      // Initial gains
      this.gainA.gain.value = 1.0;
      this.gainB.gain.value = 0.0;
      this.masterGain.gain.value = 1.0;
      
      console.log('AudioContext initialized with beat-synced mixing engine');
    } catch (error) {
      console.error('Failed to initialize AudioContext:', error);
    }
  }

  // BPM Detection using onset detection
  async detectBPM(audioBuffer) {
    try {
      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      
      // Downsample for performance
      const downsampleFactor = 4;
      const downsampledLength = Math.floor(channelData.length / downsampleFactor);
      const downsampled = new Float32Array(downsampledLength);
      
      for (let i = 0; i < downsampledLength; i++) {
        downsampled[i] = channelData[i * downsampleFactor];
      }
      
      // Simple energy-based onset detection
      const windowSize = Math.floor(sampleRate / downsampleFactor * 0.05); // 50ms windows
      const energy = [];
      
      for (let i = 0; i < downsampled.length - windowSize; i += windowSize) {
        let sum = 0;
        for (let j = 0; j < windowSize; j++) {
          sum += downsampled[i + j] * downsampled[i + j];
        }
        energy.push(sum / windowSize);
      }
      
      // Detect onsets (energy peaks)
      const threshold = this.calculateThreshold(energy);
      const onsets = [];
      
      for (let i = 1; i < energy.length - 1; i++) {
        if (energy[i] > threshold && energy[i] > energy[i - 1] && energy[i] > energy[i + 1]) {
          onsets.push(i * windowSize / (sampleRate / downsampleFactor));
        }
      }
      
      // Calculate BPM from onset intervals
      if (onsets.length < 2) return 120; // Default
      
      const intervals = [];
      for (let i = 1; i < onsets.length; i++) {
        intervals.push(onsets[i] - onsets[i - 1]);
      }
      
      // Filter intervals (typical BPM range 80-160)
      const validIntervals = intervals.filter(i => i >= 0.375 && i <= 0.75); // 160-80 BPM
      
      if (validIntervals.length === 0) return 120;
      
      const avgInterval = validIntervals.reduce((a, b) => a + b) / validIntervals.length;
      const bpm = 60 / avgInterval;
      
      // Round to nearest BPM
      return Math.round(bpm * 2) / 2; // Half-BPM precision
    } catch (error) {
      console.error('BPM detection failed:', error);
      return 120; // Default BPM
    }
  }

  calculateThreshold(energy) {
    const mean = energy.reduce((a, b) => a + b) / energy.length;
    const variance = energy.reduce((a, b) => a + Math.pow(b - mean, 2)) / energy.length;
    return mean + Math.sqrt(variance) * 1.5;
  }

  // Generate beat grid
  generateBeatGrid(audioBuffer, bpm) {
    const beatDuration = 60 / bpm;
    const beats = [];
    
    for (let i = 0; i < audioBuffer.duration / beatDuration; i++) {
      beats.push(i * beatDuration);
    }
    
    return beats;
  }

  async loadAudioFile(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.currentBuffer = audioBuffer;
      
      // Detect BPM and generate beat grid
      this.currentBPM = await this.detectBPM(audioBuffer);
      this.beatGrid = this.generateBeatGrid(audioBuffer, this.currentBPM);
      
      console.log('Audio file loaded:', file.name, 'BPM:', this.currentBPM);
      return audioBuffer;
    } catch (error) {
      console.error('Failed to load audio file:', error);
      throw error;
    }
  }

  async loadAudioFromUrl(url) {
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.currentBuffer = audioBuffer;
      
      this.currentBPM = await this.detectBPM(audioBuffer);
      this.beatGrid = this.generateBeatGrid(audioBuffer, this.currentBPM);
      
      console.log('Audio loaded from URL:', url, 'BPM:', this.currentBPM);
      return audioBuffer;
    } catch (error) {
      console.error('Failed to load audio from URL:', error);
      throw error;
    }
  }

  play() {
    if (!this.currentBuffer || !this.audioContext) {
      console.error('No audio loaded or AudioContext not initialized');
      return;
    }

    try {
      this.stop();
      
      this.sourceA = this.audioContext.createBufferSource();
      this.sourceA.buffer = this.currentBuffer;
      this.sourceA.connect(this.gainA);
      this.sourceA.start(0);
      this.isPlaying = true;
      
      this.sourceA.onended = () => {
        this.isPlaying = false;
        console.log('Playback ended');
      };
      
      console.log('Playback started on deck A at', this.currentBPM, 'BPM');
    } catch (error) {
      console.error('Failed to play audio:', error);
    }
  }

  pause() {
    if (this.sourceA && this.isPlaying) {
      try {
        this.audioContext.suspend();
        console.log('Playback paused');
      } catch (error) {
        console.error('Failed to pause audio:', error);
      }
    }
  }

  resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        this.audioContext.resume();
        console.log('Playback resumed');
      } catch (error) {
        console.error('Failed to resume audio:', error);
      }
    }
  }

  stop() {
    if (this.sourceA) {
      try {
        this.sourceA.stop();
        this.sourceA = null;
        this.isPlaying = false;
      } catch (error) {
        // Ignore if already stopped
      }
    }
    
    if (this.sourceB) {
      try {
        this.sourceB.stop();
        this.sourceB = null;
      } catch (error) {
        // Ignore if already stopped
      }
    }
    
    if (this.crossfadeTimer) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
    
    this.crossfading = false;
    
    if (this.gainA) this.gainA.gain.value = 1.0;
    if (this.gainB) this.gainB.gain.value = 0.0;
  }

  // Beat-synced crossfade
  async crossfadeTo(nextBuffer) {
    if (!this.audioContext || !nextBuffer) return;
    
    console.log('Starting beat-synced crossfade...');
    
    this.crossfading = true;
    this.nextBuffer = nextBuffer;
    
    // Detect BPM for next track
    this.nextBPM = await this.detectBPM(nextBuffer);
    this.nextBeatGrid = this.generateBeatGrid(nextBuffer, this.nextBPM);
    
    console.log('Current BPM:', this.currentBPM, 'Next BPM:', this.nextBPM);
    
    // Calculate crossfade point (32 bars before end for long sexy mix)
    const beatDuration = 60 / this.currentBPM;
    const crossfadeBeats = 32; // 32 bars
    const crossfadeDuration = crossfadeBeats * beatDuration;
    const currentDuration = this.currentBuffer.duration;
    const crossfadeStartTime = currentDuration - crossfadeDuration;
    
    if (crossfadeStartTime <= 0) {
      this.performImmediateCrossfade();
      return;
    }
    
    // Find nearest beat to crossfade start
    const crossfadeBeatIndex = this.beatGrid.findIndex(b => b >= crossfadeStartTime);
    const actualCrossfadeTime = this.beatGrid[Math.max(0, crossfadeBeatIndex - 1)] || crossfadeStartTime;
    
    const currentTime = this.audioContext.currentTime;
    const delayUntilCrossfade = (actualCrossfadeTime - currentTime) * 1000;
    
    this.crossfadeTimer = setTimeout(() => {
      this.performBeatSyncedCrossfade(crossfadeDuration);
    }, delayUntilCrossfade);
    
    console.log('Crossfade scheduled at beat:', actualCrossfadeTime, 'Duration:', crossfadeDuration + 's');
  }

  performBeatSyncedCrossfade(crossfadeDuration) {
    if (!this.audioContext) return;
    
    console.log('Performing beat-synced crossfade...');
    
    // Start next track on deck B at phase-aligned position
    this.sourceB = this.audioContext.createBufferSource();
    this.sourceB.buffer = this.nextBuffer;
    this.sourceB.connect(this.gainB);
    this.sourceB.start(0);
    
    const startTime = this.audioContext.currentTime;
    const endTime = startTime + crossfadeDuration;
    
    // Smooth long crossfade curve (S-curve for sexy mix)
    const curveDuration = crossfadeDuration;
    const curvePoints = 100;
    
    for (let i = 0; i <= curvePoints; i++) {
      const t = i / curvePoints;
      const time = startTime + t * curveDuration;
      
      // Sigmoid curve for smooth crossfade
      const sigmoid = 1 / (1 + Math.exp(-10 * (t - 0.5)));
      
      this.gainA.gain.setValueAtTime(1 - sigmoid, time);
      this.gainB.gain.setValueAtTime(sigmoid, time);
    }
    
    setTimeout(() => {
      if (this.sourceA) {
        this.sourceA.stop();
        this.sourceA = null;
      }
      
      this.currentBuffer = this.nextBuffer;
      this.nextBuffer = null;
      this.currentBPM = this.nextBPM;
      this.beatGrid = this.nextBeatGrid;
      this.sourceA = this.sourceB;
      this.sourceB = null;
      
      this.gainA.gain.value = 1.0;
      this.gainB.gain.value = 0.0;
      
      this.crossfading = false;
      console.log('Beat-synced crossfade complete');
      
    }, crossfadeDuration * 1000);
  }

  performImmediateCrossfade() {
    console.log('Performing immediate crossfade...');
    
    this.sourceB = this.audioContext.createBufferSource();
    this.sourceB.buffer = this.nextBuffer;
    this.sourceB.connect(this.gainB);
    this.sourceB.start(0);
    
    const startTime = this.audioContext.currentTime;
    const endTime = startTime + 4; // 4 second quick crossfade
    
    this.gainA.gain.setValueAtTime(1.0, startTime);
    this.gainA.gain.linearRampToValueAtTime(0.0, endTime);
    
    this.gainB.gain.setValueAtTime(0.0, startTime);
    this.gainB.gain.linearRampToValueAtTime(1.0, endTime);
    
    setTimeout(() => {
      if (this.sourceA) {
        this.sourceA.stop();
        this.sourceA = null;
      }
      
      this.currentBuffer = this.nextBuffer;
      this.nextBuffer = null;
      this.sourceA = this.sourceB;
      this.sourceB = null;
      
      this.gainA.gain.value = 1.0;
      this.gainB.gain.value = 0.0;
      
      this.crossfading = false;
    }, 4000);
  }

  setVolume(volume) {
    if (this.masterGain) {
      this.masterGain.gain.value = volume;
    }
  }

  getDuration() {
    if (this.currentBuffer) {
      return this.currentBuffer.duration;
    }
    return 0;
  }

  getCurrentTime() {
    if (this.audioContext) {
      return this.audioContext.currentTime;
    }
    return 0;
  }

  getBPM() {
    return this.currentBPM;
  }
}

export default new AudioManager();