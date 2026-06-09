// AudioManager — 16-channel WASM DSP mixer with AudioWorklet
// Bridge between HTMLAudioElements and the WASM engine

class AudioManager {
  constructor() {
    this.audioContext = null;
    this.workletNode = null;
    this.wasmReady = false;
    this.meterCallback = null;
    this.wasmBuffer = null;

    // Master output analyzer for VU meter
    this.masterAnalyser = null;

    // FX chain (reverb)
    this.fxEnabled = false;
    this.dryGain = null;
    this.wetGain = null;
    this.convolver = null;

    // Spectrum analyzer for hero visualizer
    this.spectrumAnalyser = null;

    // 16 channel slots
    this.channels = Array(16).fill(null).map(() => ({
      element: null,
      sourceNode: null,
      gainNode: null,
      isLoading: false
    }));

    // Channel error callbacks for stream recovery
    this.channelErrorCallbacks = {}   // { channelIndex: callback }

    // Screen wake lock to prevent sleep during playback
    this.wakeLock = null
  }

  // Register error handler for a specific channel
  onChannelError(channelIndex, callback) {
    this.channelErrorCallbacks[channelIndex] = callback
  }

  // Acquire screen wake lock (prevents device sleep)
  async acquireWakeLock() {
    if (!('wakeLock' in navigator)) return
    try {
      this.wakeLock = await navigator.wakeLock.request('screen')
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null
      })
    } catch (e) {
      // Wake lock denied (battery saver mode, etc.) — non-fatal
    }
  }

  // Release screen wake lock
  releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release()
      this.wakeLock = null
    }
  }

  // Create synthetic impulse response for reverb
  _createReverb(duration = 2.2, decay = 2.0) {
    const ctx = this.audioContext
    const sr = ctx.sampleRate
    const len = sr * duration
    const buf = ctx.createBuffer(2, len, sr)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
      }
    }
    const conv = ctx.createConvolver()
    conv.buffer = buf
    return conv
  }

  // Initialize AudioContext and AudioWorklet (call on first user gesture)
  async initialize() {
    if (this.audioContext) {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      return;
    }

    try {
      // Create AudioContext
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 44100,
        latencyHint: 'interactive'
      });

      // Fetch WASM module
      const wasmResponse = await fetch('/dsp/engine.wasm');
      this.wasmBuffer = await wasmResponse.arrayBuffer();

      // Load AudioWorklet
      await this.audioContext.audioWorklet.addModule('/audio/engine.worklet.js');

      // Create worklet node with 16 inputs, 1 stereo output
      this.workletNode = new AudioWorkletNode(this.audioContext, 'sf-engine', {
        numberOfInputs: 16,
        numberOfOutputs: 1,
        outputChannelCount: [2], // Stereo output
        channelCount: 1,
        channelCountMode: 'explicit'
      });

      // Create master output analyzer for VU meter
      this.masterAnalyser = this.audioContext.createAnalyser();
      this.masterAnalyser.fftSize = 256;
      this.masterAnalyser.smoothingTimeConstant = 0.3;

      // Set up FX chain (dry/wet reverb)
      this.dryGain = this.audioContext.createGain()
      this.wetGain = this.audioContext.createGain()
      this.dryGain.gain.value = 1.0
      this.wetGain.gain.value = 0.0   // FX off by default
      this.convolver = this._createReverb()

      // Connect: worklet → dry gain → analyser → destination
      //                  └→ convolver → wet gain →┘
      this.workletNode.connect(this.dryGain)
      this.workletNode.connect(this.convolver)
      this.convolver.connect(this.wetGain)
      this.dryGain.connect(this.masterAnalyser)
      this.wetGain.connect(this.masterAnalyser)
      this.masterAnalyser.connect(this.audioContext.destination);

      // Listen for worklet messages
      this.workletNode.port.onmessage = (e) => {
        switch (e.data.type) {
          case 'ready':
            this.wasmReady = true
            console.log('%c[SF Engine] WASM ready', 'color:#d4a64f;font-weight:bold')
            // Re-activate any channels that started playing before WASM was ready
            for (let i = 0; i < 16; i++) {
              if (this.channels[i].element && !this.channels[i].element.paused) {
                this.workletNode.port.postMessage({ type: 'set-active', channel: i, value: 1 })
              }
            }
            break;
          case 'error':
            console.error('WASM error:', e.data.message);
            break;
          case 'meter':
            if (this.meterCallback) {
              this.meterCallback(e.data.values);
            }
            break;
        }
      };

      // Send WASM to worklet for instantiation
      this.workletNode.port.postMessage({
        type: 'init-wasm',
        buffer: this.wasmBuffer
      });

      // Handle page visibility changes — re-acquire wake lock when tab returns
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.fxEnabled !== undefined) {
          // Re-acquire wake lock if we're actively playing when tab comes back
          const anyActive = this.channels.some(c => c.element && !c.element.paused)
          if (anyActive) this.acquireWakeLock()
        }
      })

      console.log('AudioManager initialized');
      return this.audioContext;
    } catch (error) {
      console.error('[SF] AudioManager init failed:', error);
      // Fallback: keep AudioContext alive so direct audio play still works
      // (no DSP processing, but sound comes out)
      if (this.audioContext && !this.workletNode) {
        console.warn('[SF] Running without WASM DSP — direct output only');
        this.fallbackMode = true;
      } else {
        throw error;
      }
    }
  }

  // Play a stream on a specific channel (creates/connects HTMLAudioElement internally)
  // onReady callback fires when audio is actually playing (for shadow channel volume)
  play(channelIndex, url, meta = null, onReady = null) {
    if (channelIndex < 0 || channelIndex >= 16) {
      console.error('Invalid channel index:', channelIndex);
      return;
    }

    if (!this.audioContext || !this.workletNode) {
      console.error('AudioManager not initialized');
      return;
    }

    const channel = this.channels[channelIndex];

    // Prevent multiple simultaneous play() calls on same channel
    if (channel.isLoading) {
      console.warn(`Channel ${channelIndex} already loading, ignoring duplicate play()`);
      return;
    }
    channel.isLoading = true;

    // Stop and clean up previous element fully before replacing
    if (channel.element) {
      channel.element.pause();
      channel.element.src = '';
      channel.element.load(); // Force abort of stream loading
      channel.element = null;
    }
    if (channel.sourceNode) {
      channel.sourceNode.disconnect();
      channel.sourceNode = null;
    }

    // Create new audio element - must be fresh to avoid state leakage
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto'; // Start buffering immediately
    // Set src and load first, then currentTime (some browsers need this order)
    audio.src = url;
    audio.load();
    channel.element = audio;

    // Stream error recovery handlers
    audio.onerror = () => {
      console.warn(`Channel ${channelIndex} stream error — signaling for retry`)
      const cb = this.channelErrorCallbacks[channelIndex]
      if (cb) cb(channelIndex)
    }
    audio.onstalled = () => {
      // Stalled for more than 8 seconds = dead stream
      const stalledTimer = setTimeout(() => {
        if (channel.element === audio) {
          console.warn(`Channel ${channelIndex} stalled — signaling for retry`)
          const cb = this.channelErrorCallbacks[channelIndex]
          if (cb) cb(channelIndex)
        }
      }, 8000)
      audio.onprogress = () => clearTimeout(stalledTimer)
    }

    // Create MediaElementAudioSourceNode
    try {
      channel.sourceNode = this.audioContext.createMediaElementSource(audio);
    } catch (e) {
      // CORS: station doesn't allow Web Audio tap — play directly without DSP
      console.warn(`[SF] Ch${channelIndex} CORS blocked, playing direct:`, e.message);
      audio.crossOrigin = null;
      audio.currentTime = 0;
      audio.play().catch(() => {});
      this.acquireWakeLock();
      return;
    }

    // Connect through WASM worklet, or direct to destination in fallback mode
    if (this.workletNode && !this.fallbackMode) {
      channel.sourceNode.connect(this.workletNode, 0, channelIndex);
    } else {
      channel.sourceNode.connect(this.masterAnalyser || this.audioContext.destination);
    }

    // Wait for audio to be ready before playing (prevents delay)
    const startPlaying = () => {
      // Clear loading flag
      channel.isLoading = false;

      // Seed WASM engine with metadata hints BEFORE activating channel
      // This ensures beat tracker is ready before audio starts flowing
      if (this.wasmReady && this.workletNode) {
        // Reset beat tracker first (clears old state)
        this.workletNode.port.postMessage({
          type: 'reset-beat-tracker',
          channel: channelIndex
        });

        // Seed with pre-analyzed BPM for instant lock (before channel is active)
        if (meta?.bpm) {
          this.setChannelBpmHint(channelIndex, meta.bpm);
        }

        // Seed with pre-analyzed key for harmonic mixing
        if (meta?.camelot) {
          this.setChannelKeyHint(channelIndex, meta.camelot);
        }

        // NOW activate channel — beat tracker is already primed
        console.log(`[SF] Activating channel ${channelIndex}${meta?.bpm ? ' with locked BPM' : ' (no BPM hint)'}`)
        this.workletNode.port.postMessage({ type: 'set-active', channel: channelIndex, value: 1 });
      } else if (this.workletNode) {
        // WASM not ready yet, just activate (will seed when ready via onmessage 'ready')
        console.log(`[SF] Activating channel ${channelIndex} (WASM not ready, will seed BPM when ready)`)
        this.workletNode.port.postMessage({ type: 'set-active', channel: channelIndex, value: 1 });
      }

      // Ensure audio starts from beginning (for files, not live streams)
      try { audio.currentTime = 0; } catch (e) {}

      // Start playing
      audio.play()
        .then(() => {
          console.log('Playing on channel', channelIndex, ':', url);
          // Notify caller that audio is ready (for shadow channel volume setup)
          if (onReady) onReady(channelIndex);
        })
        .catch(err => {
          console.error('Play error on channel', channelIndex, err);
          channel.isLoading = false;
        });

      // Prevent device sleep while audio is playing
      this.acquireWakeLock();
    };

    // If already ready, play immediately; otherwise wait for canplay
    if (audio.readyState >= 3) {
      startPlaying();
    } else {
      // 3 second timeout - if audio doesn't load, give up
      const timeout = setTimeout(() => {
        console.error(`Channel ${channelIndex} audio load timeout`);
        channel.isLoading = false;
        if (channel.element === audio) {
          this.stop(channelIndex);
        }
      }, 3000);

      audio.addEventListener('canplay', () => {
        clearTimeout(timeout);
        startPlaying();
      }, { once: true });

      audio.addEventListener('error', () => {
        clearTimeout(timeout);
        channel.isLoading = false;
      }, { once: true });
    }
  }

  // Stop playback on a specific channel
  stop(channelIndex) {
    if (channelIndex < 0 || channelIndex >= 16) return;

    const channel = this.channels[channelIndex];

    // Clear loading flag
    channel.isLoading = false;

    if (channel.element) {
      channel.element.pause();
      channel.element.src = '';
      channel.element.load(); // Force abort of stream loading
    }

    if (channel.sourceNode) {
      channel.sourceNode.disconnect();
      channel.sourceNode = null;
    }

    channel.element = null;

    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'set-active',
        channel: channelIndex,
        value: 0
      });
    }

    // Release wake lock only if no channels are playing
    const anyStillPlaying = this.channels.some(c => c.element && !c.element.paused)
    if (!anyStillPlaying) {
      this.releaseWakeLock()
    }

    console.log('Stopped channel', channelIndex);
  }

  // Connect an HTMLAudioElement to a channel (low-level API)
  connectChannel(index, htmlAudioElement) {
    if (index < 0 || index >= 16) {
      console.error('Invalid channel index:', index);
      return;
    }

    if (!this.audioContext || !this.workletNode) {
      console.error('AudioManager not initialized');
      return;
    }

    const channel = this.channels[index];

    // Disconnect previous source if any
    if (channel.sourceNode) {
      channel.sourceNode.disconnect();
      channel.sourceNode = null;
    }

    // Store the audio element
    channel.element = htmlAudioElement;

    // Create MediaElementAudioSourceNode
    channel.sourceNode = this.audioContext.createMediaElementSource(htmlAudioElement);

    // Connect to worklet input[index]
    channel.sourceNode.connect(this.workletNode, 0, index);

    // Activate channel in WASM
    this.workletNode.port.postMessage({
      type: 'set-active',
      channel: index,
      value: 1
    });

    console.log('Connected channel', index);
  }

  // Disconnect a channel (low-level API)
  disconnectChannel(index) {
    if (index < 0 || index >= 16) return;

    const channel = this.channels[index];

    if (channel.sourceNode) {
      channel.sourceNode.disconnect();
      channel.sourceNode = null;
    }

    channel.element = null;

    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'set-active',
        channel: index,
        value: 0
      });
    }

    console.log('Disconnected channel', index);
  }

  // Set HTML element volume independently (for shadow channels)
  setChannelVolume(index, volume) {
    // volume 0.0-1.0 — controls HTMLAudioElement output level
    const ch = this.channels[index]
    if (ch?.element) ch.element.volume = Math.max(0, Math.min(1, volume))

    // Also set WASM gain since worklet gets audio before element volume
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'set-gain',
        channel: index,
        value: volume  // linear 0.0-1.0
      })
    }
  }

  // Seed WASM engine with pre-analyzed BPM hint (instant beat lock)
  setChannelBpmHint(index, bpm) {
    if (index < 0 || index >= 16) return
    if (!this.workletNode || !this.wasmReady) return
    console.log(`[SF] Seeding BPM ${bpm} on channel ${index}`)
    this.workletNode.port.postMessage({
      type: 'set-bpm-hint', channel: index, value: bpm
    })
  }

  // Seed WASM engine with pre-analyzed Camelot key (harmonic scoring)
  setChannelKeyHint(index, camelotStr) {
    // Convert "8A" → integer encoded as (num * 2) + mode, 0=A 1=B
    if (!camelotStr || index < 0 || index >= 16) return
    if (!this.workletNode || !this.wasmReady) return
    const match = camelotStr.match(/^(\d+)([AB])$/)
    if (!match) return
    const num  = parseInt(match[1])   // 1-12
    const mode = match[2] === 'B' ? 1 : 0
    const encoded = num * 2 + mode
    this.workletNode.port.postMessage({
      type: 'set-key-hint', channel: index, value: encoded
    })
  }

  // Set channel gain in dB
  setChannelGain(index, gainDb) {
    if (index < 0 || index >= 16) return;
    if (!this.workletNode || !this.wasmReady) return;

    this.workletNode.port.postMessage({
      type: 'set-gain',
      channel: index,
      value: gainDb
    });
  }

  // Set channel EQ (low, mid, high in dB)
  setChannelEQ(index, lowDb, midDb, highDb) {
    if (index < 0 || index >= 16) return;
    if (!this.workletNode || !this.wasmReady) return;

    this.workletNode.port.postMessage({
      type: 'set-eq',
      channel: index,
      low: lowDb,
      mid: midDb,
      high: highDb
    });
  }

  // Set channel compression (threshold in dB, ratio)
  setChannelCompression(index, thresholdDb, ratio) {
    if (index < 0 || index >= 16) return;
    if (!this.workletNode || !this.wasmReady) return;

    this.workletNode.port.postMessage({
      type: 'set-compression',
      channel: index,
      threshold: thresholdDb,
      ratio: ratio
    });
  }

  // Register meter update callback (alias for onMeterUpdate)
  onMeter(callback) {
    this.meterCallback = callback;
  }

  // Register meter update callback (receives 20-float array at ~60fps)
  onMeterUpdate(callback) {
    this.meterCallback = callback;
  }

  // Get AudioContext
  getContext() {
    return this.audioContext;
  }

  // Get master output RMS levels [L, R] for VU meter (0.0 - 1.0)
  getMasterRMS() {
    if (!this.masterAnalyser) return [0, 0];

    const bufferLength = this.masterAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength * 2); // Stereo = 2x

    // Get time domain data (interleaved stereo)
    this.masterAnalyser.getByteTimeDomainData(dataArray);

    // Calculate RMS for left and right channels
    let sumL = 0, sumR = 0;
    const samplePairs = Math.floor(dataArray.length / 2);
    const samplesToUse = Math.min(samplePairs, 128);

    for (let i = 0; i < samplesToUse; i++) {
      // Convert from 0-255 to -1 to 1
      const valL = (dataArray[i * 2] - 128) / 128;
      const valR = (dataArray[i * 2 + 1] - 128) / 128;
      sumL += valL * valL;
      sumR += valR * valR;
    }

    const rmsL = Math.sqrt(sumL / samplesToUse);
    const rmsR = Math.sqrt(sumR / samplesToUse);

    return [rmsL, rmsR];
  }

  // Enable reverb FX (wetAmount 0.0-1.0)
  enableFX(wetAmount = 0.35) {
    if (!this.dryGain || !this.audioContext) return
    this.fxEnabled = true
    this.dryGain.gain.setTargetAtTime(0.72, this.audioContext.currentTime, 0.05)
    this.wetGain.gain.setTargetAtTime(wetAmount, this.audioContext.currentTime, 0.05)
  }

  // Disable reverb FX
  disableFX() {
    if (!this.dryGain || !this.audioContext) return
    this.fxEnabled = false
    this.dryGain.gain.setTargetAtTime(1.0, this.audioContext.currentTime, 0.05)
    this.wetGain.gain.setTargetAtTime(0.0, this.audioContext.currentTime, 0.05)
  }

  // Get or create spectrum analyser for hero visualizer
  getSpectrumAnalyser() {
    if (this.spectrumAnalyser) return this.spectrumAnalyser
    if (!this.audioContext || !this.workletNode) return null

    this.spectrumAnalyser = this.audioContext.createAnalyser()
    this.spectrumAnalyser.fftSize = 2048
    this.spectrumAnalyser.smoothingTimeConstant = 0.78
    this.spectrumAnalyser.minDecibels = -90
    this.spectrumAnalyser.maxDecibels = -10

    // Tap off workletNode in parallel — does not affect existing signal chain
    this.workletNode.connect(this.spectrumAnalyser)

    return this.spectrumAnalyser
  }

  // Cleanup
  destroy() {
    // Disconnect all channels
    for (let i = 0; i < 16; i++) {
      this.stop(i);
    }

    // Disconnect FX chain
    if (this.dryGain) {
      this.dryGain.disconnect();
      this.dryGain = null;
    }
    if (this.wetGain) {
      this.wetGain.disconnect();
      this.wetGain = null;
    }
    if (this.convolver) {
      this.convolver.disconnect();
      this.convolver = null;
    }

    if (this.spectrumAnalyser) {
      this.spectrumAnalyser.disconnect()
      this.spectrumAnalyser = null
    }

    if (this.masterAnalyser) {
      this.masterAnalyser.disconnect();
      this.masterAnalyser = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.wasmReady = false;
    this.meterCallback = null;
    this.wasmBuffer = null;
    this.fxEnabled = false;

    // Release wake lock on cleanup
    this.releaseWakeLock()
  }
}

// Export singleton instance
const audioManager = new AudioManager();
export default audioManager;
