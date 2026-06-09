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
      gainNode: null
    }));
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
      await this.audioContext.audioWorklet.addModule('/src/audio/engine.worklet.js');

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

      // Send WASM to worklet for instantiation
      this.workletNode.port.postMessage({
        type: 'init-wasm',
        buffer: this.wasmBuffer
      });

      console.log('AudioManager initialized');
      return this.audioContext;
    } catch (error) {
      console.error('Failed to initialize AudioManager:', error);
      throw error;
    }
  }

  // Play a stream on a specific channel (creates/connects HTMLAudioElement internally)
  play(channelIndex, url) {
    if (channelIndex < 0 || channelIndex >= 16) {
      console.error('Invalid channel index:', channelIndex);
      return;
    }

    if (!this.audioContext || !this.workletNode) {
      console.error('AudioManager not initialized');
      return;
    }

    const channel = this.channels[channelIndex];

    // Disconnect previous source if any
    if (channel.sourceNode) {
      channel.sourceNode.disconnect();
      channel.sourceNode = null;
    }

    // Create new audio element
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'none';
    audio.src = url;
    channel.element = audio;

    // Create MediaElementAudioSourceNode
    channel.sourceNode = this.audioContext.createMediaElementSource(audio);

    // Connect to worklet input[channelIndex]
    channel.sourceNode.connect(this.workletNode, 0, channelIndex);

    // Activate channel in WASM
    if (this.wasmReady) {
      this.workletNode.port.postMessage({
        type: 'set-active',
        channel: channelIndex,
        value: 1
      });
    }

    // Start playing
    audio.play().catch(err => console.error('Play error on channel', channelIndex, err));

    console.log('Playing on channel', channelIndex, ':', url);
  }

  // Stop playback on a specific channel
  stop(channelIndex) {
    if (channelIndex < 0 || channelIndex >= 16) return;

    const channel = this.channels[channelIndex];

    if (channel.element) {
      channel.element.pause();
      channel.element.src = '';
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
  }
}

// Export singleton instance
const audioManager = new AudioManager();
export default audioManager;
