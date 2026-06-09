// AudioManager — 16-channel WASM DSP mixer with AudioWorklet
class AudioManager {
  constructor() {
    this.audioContext = null;
    this.workletNode = null;
    this.mediaSources = []; // 16 MediaElementAudioSourceNode
    this.audioElements = []; // 16 HTMLAudioElement
    this.wasmReady = false;
    this.meterCallback = null;

    // Master output analyzer for VU meter
    this.masterAnalyser = null;

    // WASM module buffer (will be fetched)
    this.wasmBuffer = null;
  }

  async initialize() {
    try {
      // Create AudioContext
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 44100,
        latencyHint: 'interactive'
      });

      // Create 16 audio elements (one per channel)
      for (let i = 0; i < 16; i++) {
        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.preload = 'none';
        this.audioElements.push(audio);
      }

      // Fetch WASM module
      const wasmResponse = await fetch('/dsp/engine.wasm');
      this.wasmBuffer = await wasmResponse.arrayBuffer();

      // Load AudioWorklet
      await this.audioContext.audioWorklet.addModule('/src/audio/engine.worklet.js');

      // Create worklet node with 16 inputs (one per channel), 2 outputs (stereo)
      this.workletNode = new AudioWorkletNode(this.audioContext, 'sf-engine', {
        numberOfInputs: 16,
        numberOfOutputs: 1,
        outputChannelCount: [2], // Stereo output
        channelCount: 1,
        channelCountMode: 'explicit'
      });

      // Connect media sources to worklet inputs
      for (let i = 0; i < 16; i++) {
        const source = this.audioContext.createMediaElementSource(this.audioElements[i]);
        this.mediaSources.push(source);
        // Connect each source to worklet input i
        source.connect(this.workletNode, 0, i);
      }

      // Create master output analyzer for VU meter
      this.masterAnalyser = this.audioContext.createAnalyser();
      this.masterAnalyser.fftSize = 256;
      this.masterAnalyser.smoothingTimeConstant = 0.3;

      // Connect worklet output to analyzer, then to destination
      this.workletNode.connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.audioContext.destination);

      // Send WASM to worklet for instantiation
      this.workletNode.port.postMessage({
        type: 'init-wasm',
        buffer: this.wasmBuffer
      });

      // Listen for worklet messages
      this.workletNode.port.onmessage = (e) => {
        switch (e.data.type) {
          case 'ready':
            this.wasmReady = true;
            console.log('WASM engine ready');
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

      // Resume context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      console.log('AudioManager initialized with 16-channel WASM engine');
      return true;
    } catch (error) {
      console.error('Failed to initialize AudioManager:', error);
      throw error;
    }
  }

  // Play a stream on a specific channel
  play(channelIndex, url) {
    if (channelIndex < 0 || channelIndex >= 16) {
      console.error('Invalid channel index:', channelIndex);
      return;
    }

    try {
      const audio = this.audioElements[channelIndex];

      // Stop current playback on this channel
      audio.pause();
      audio.src = '';

      // Set new source and play
      audio.src = url;
      audio.play().catch(err => console.error('Play error on channel', channelIndex, err));

      // Activate channel in WASM
      if (this.wasmReady && this.workletNode) {
        this.workletNode.port.postMessage({
          type: 'set-active',
          channel: channelIndex,
          value: 1
        });
      }

      console.log('Playing on channel', channelIndex, ':', url);
    } catch (error) {
      console.error('Failed to play on channel', channelIndex, error);
    }
  }

  // Stop playback on a specific channel
  stop(channelIndex) {
    if (channelIndex < 0 || channelIndex >= 16) return;

    try {
      const audio = this.audioElements[channelIndex];
      audio.pause();
      audio.src = '';

      // Deactivate channel in WASM
      if (this.wasmReady && this.workletNode) {
        this.workletNode.port.postMessage({
          type: 'set-active',
          channel: channelIndex,
          value: 0
        });
      }

      console.log('Stopped channel', channelIndex);
    } catch (error) {
      console.error('Failed to stop channel', channelIndex, error);
    }
  }

  // Set channel volume (0.0 - 1.0)
  setVolume(channelIndex, gain) {
    if (channelIndex < 0 || channelIndex >= 16) return;

    if (this.wasmReady && this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'set-gain',
        channel: channelIndex,
        value: gain
      });
    }
  }

  // Set channel EQ (low, mid, high in dB)
  setEQ(channelIndex, low_db, mid_db, high_db) {
    if (channelIndex < 0 || channelIndex >= 16) return;

    if (this.wasmReady && this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'set-eq',
        channel: channelIndex,
        low: low_db,
        mid: mid_db,
        high: high_db
      });
    }
  }

  // Set channel compression (threshold in dB, ratio)
  setCompression(channelIndex, threshold_db, ratio) {
    if (channelIndex < 0 || channelIndex >= 16) return;

    if (this.wasmReady && this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'set-compression',
        channel: channelIndex,
        threshold: threshold_db,
        ratio: ratio
      });
    }
  }

  // Set meter callback — receives 20-float array:
  // [0-15] channel RMS, [16] active_channel, [17] pending_channel, [18] crossfade_progress, [19] BPM
  onMeter(callback) {
    this.meterCallback = callback;
  }

  // Get current audio context time
  getCurrentTime() {
    return this.audioContext ? this.audioContext.currentTime : 0;
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

  // Suspend audio context
  async suspend() {
    if (this.audioContext && this.audioContext.state === 'running') {
      await this.audioContext.suspend();
    }
  }

  // Resume audio context
  async resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  // Stop all channels
  stopAll() {
    for (let i = 0; i < 16; i++) {
      this.stop(i);
    }
  }

  // Cleanup
  destroy() {
    this.stopAll();

    if (this.masterAnalyser) {
      this.masterAnalyser.disconnect();
      this.masterAnalyser = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    this.mediaSources.forEach(source => source.disconnect());
    this.mediaSources = [];

    this.audioElements.forEach(audio => {
      audio.pause();
      audio.src = '';
    });
    this.audioElements = [];

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.wasmReady = false;
    this.meterCallback = null;
  }
}

// Export singleton instance
const audioManager = new AudioManager();
export default audioManager;
