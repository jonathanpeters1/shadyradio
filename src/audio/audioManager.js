// AudioManager — 16-channel WASM DSP mixer
// Architecture: fetch + decodeAudioData → push PCM chunks to worklet via port messages
// The worklet holds ring buffers; WASM reads from them each process() call.

const CHUNK_SIZE = 4096   // samples per push message
const RING_LOW   = 8192   // worklet asks for more when ring drops below this

class AudioManager {
  constructor() {
    this.audioContext  = null
    this.workletNode   = null
    this.wasmReady     = false
    this.meterCallback = null
    this.wasmBuffer    = null
    this.masterAnalyser = null

    // FX chain (reverb)
    this.fxEnabled = false
    this.dryGain   = null
    this.wetGain   = null
    this.convolver = null

    // Decoded buffer cache — keyed by URL
    this.decodedBuffers = {}

    // Per-channel state
    this.channels = Array.from({ length: 16 }, () => ({
      buffer:      null,   // decoded AudioBuffer currently playing
      offset:      0,      // current read position in samples
      active:      false,
      bpm:         null,
      nextBuffer:  null,   // pre-decoded next track (gapless handoff)
      nextBpm:     null,
      nextOffset:  0,
      preloading:  false,  // fetch in flight
    }))

    // Per-channel callbacks
    this.onTrackEnded  = Array(16).fill(null)   // cb(channelIndex) — called when track ends
    this.onNeedPreload = Array(16).fill(null)   // cb(channelIndex) → Promise<{buffer,bpm,offsetSec}>

    this._masterBpm  = null
    this._wakeLock   = null
  }

  // ── Initialization ────────────────────────────────────────────────────────

  async initialize() {
    if (this.audioContext) {
      if (this.audioContext.state === 'suspended') await this.audioContext.resume()
      return
    }

    this.audioContext = new AudioContext()

    this.masterAnalyser = this.audioContext.createAnalyser()
    this.masterAnalyser.fftSize = 256

    // FX chain
    this.dryGain = this.audioContext.createGain()
    this.wetGain = this.audioContext.createGain()
    this.wetGain.gain.value = 0
    this.convolver = this._createReverb()

    // Load WASM
    const wasmRes = await fetch('/dsp/engine.wasm')
    this.wasmBuffer = await wasmRes.arrayBuffer()

    // Load worklet
    await this.audioContext.audioWorklet.addModule('/audio/engine.worklet.js')

    // Create worklet node — no audio inputs, one stereo output
    this.workletNode = new AudioWorkletNode(this.audioContext, 'sf-engine', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { sampleRate: this.audioContext.sampleRate },
    })

    // Wire: worklet → dry+wet → analyser → destination
    this.workletNode.connect(this.dryGain)
    this.workletNode.connect(this.convolver)
    this.convolver.connect(this.wetGain)
    this.dryGain.connect(this.masterAnalyser)
    this.wetGain.connect(this.masterAnalyser)
    this.masterAnalyser.connect(this.audioContext.destination)

    // Message handler
    this.workletNode.port.onmessage = (e) => {
      const d = e.data
      if (d.type === 'wasm-ready') {
        this.wasmReady = true
        console.log('[AudioManager] WASM ready')
        // Activate all 16 channels
        for (let i = 0; i < 16; i++) {
          this.workletNode.port.postMessage({ type: 'set-active', channel: i, value: 1 })
        }
      } else if (d.type === 'meters') {
        if (this.meterCallback) this.meterCallback(d.meters)
      } else if (d.type === 'need-more') {
        // Worklet ring is running low — push more PCM
        this._pushNextChunk(d.channel)
      } else if (d.type === 'error') {
        console.error('[AudioManager] WASM error:', d.message)
      }
    }

    // Boot WASM in worklet
    this.workletNode.port.postMessage({ type: 'init-wasm', buffer: this.wasmBuffer })

    try {
      if (navigator.wakeLock) this._wakeLock = await navigator.wakeLock.request('screen')
    } catch {}
  }

  getContext() { return this.audioContext }

  // ── Reverb ────────────────────────────────────────────────────────────────

  _createReverb(duration = 2.2, decay = 2.0) {
    const ctx = this.audioContext
    const sr  = ctx.sampleRate
    const len = Math.floor(sr * duration)
    const buf = ctx.createBuffer(2, len, sr)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
    const conv = ctx.createConvolver()
    conv.buffer = buf
    return conv
  }

  enableFX(wet = 0.35) {
    this.fxEnabled = true
    if (this.dryGain) this.dryGain.gain.value = 1 - wet
    if (this.wetGain) this.wetGain.gain.value = wet
  }

  disableFX() {
    this.fxEnabled = false
    if (this.dryGain) this.dryGain.gain.value = 1
    if (this.wetGain) this.wetGain.gain.value = 0
  }

  // ── Fetch + decode ────────────────────────────────────────────────────────

  async fetchDecode(url) {
    if (this.decodedBuffers[url]) return this.decodedBuffers[url]
    const r = await fetch(url)
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`)
    const buf = await this.audioContext.decodeAudioData(await r.arrayBuffer())
    this.decodedBuffers[url] = buf
    return buf
  }

  async preload(urls) {
    return Promise.all(urls.map(u => this.fetchDecode(u).catch(() => null)))
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  setMasterBpm(bpm) { this._masterBpm = bpm }

  // Play a decoded AudioBuffer on a channel.
  // offset = start position in seconds (e.g. gridOffsetSec).
  // bpm    = track BPM for tempo-lock (playbackRate = masterBpm / bpm, applied via resampling).
  playBuffer(channelIndex, buffer, when = null, offsetSec = 0, bpm = null) {
    if (!this.audioContext || !this.workletNode) return null
    const ch = this.channels[channelIndex]

    // Resample if tempo-locking
    let playBuf = buffer
    if (bpm && this._masterBpm && Math.abs(bpm - this._masterBpm) > 0.5) {
      playBuf = this._resampleBuffer(buffer, bpm, this._masterBpm)
    }

    // Convert offsetSec to sample index
    const offsetSamples = Math.max(0, Math.floor(offsetSec * playBuf.sampleRate))

    ch.buffer  = playBuf
    ch.offset  = offsetSamples
    ch.active  = true
    ch.bpm     = bpm

    // Activate in WASM
    this.workletNode.port.postMessage({ type: 'set-active', channel: channelIndex, value: 1 })

    // Push first batch of chunks to fill the ring (~740ms of audio)
    this._pushChunks(channelIndex, 8)

    return when ?? (this.audioContext.currentTime + 0.05)
  }

  // Simple time-domain resample (linear interp) for tempo-lock
  _resampleBuffer(buffer, fromBpm, toBpm) {
    const ratio = fromBpm / toBpm
    const inData  = buffer.getChannelData(0)
    const outLen  = Math.floor(inData.length / ratio)
    const offBuf  = this.audioContext.createBuffer(1, outLen, buffer.sampleRate)
    const outData = offBuf.getChannelData(0)
    for (let i = 0; i < outLen; i++) {
      const pos  = i * ratio
      const lo   = Math.floor(pos)
      const frac = pos - lo
      const a    = inData[lo]     ?? 0
      const b    = inData[lo + 1] ?? 0
      outData[i] = a + frac * (b - a)
    }
    return offBuf
  }

  // Push `count` chunks of CHUNK_SIZE samples for a channel
  _pushChunks(channelIndex, count = 1) {
    const ch = this.channels[channelIndex]
    if (!ch.active || !ch.buffer) return
    const data = ch.buffer.getChannelData(0)
    for (let c = 0; c < count; c++) {
      if (ch.offset >= data.length) {
        // Track ended — swap in preloaded next buffer if ready
        if (ch.nextBuffer) {
          ch.buffer     = ch.nextBuffer
          ch.offset     = ch.nextOffset
          ch.bpm        = ch.nextBpm
          ch.nextBuffer = null
          ch.nextBpm    = null
          ch.nextOffset = 0
          ch.preloading = false
          // Kick off preload of the track after next
          this._triggerPreload(channelIndex)
          // Continue pushing from new buffer
          const d2  = ch.buffer.getChannelData(0)
          const end = Math.min(ch.offset + CHUNK_SIZE, d2.length)
          const pcm = new Float32Array(d2.slice(ch.offset, end))
          ch.offset = end
          this.workletNode.port.postMessage({ type: 'push-pcm', channel: channelIndex, pcm }, [pcm.buffer])
          continue
        }
        // No preloaded buffer — track ends; fire callback to load next
        ch.active = false
        ch.buffer = null
        const cb = this.onTrackEnded[channelIndex]
        if (cb) cb(channelIndex)
        else this.workletNode.port.postMessage({ type: 'stop-channel', channel: channelIndex })
        return
      }
      const end = Math.min(ch.offset + CHUNK_SIZE, data.length)
      const pcm = new Float32Array(data.slice(ch.offset, end))
      ch.offset = end
      this.workletNode.port.postMessage({ type: 'push-pcm', channel: channelIndex, pcm }, [pcm.buffer])
    }
  }

  // Called when worklet signals ring is low — push more and trigger preload
  _pushNextChunk(channelIndex) {
    this._pushChunks(channelIndex, 4)
    this._triggerPreload(channelIndex)
  }

  // Start preloading the next track if not already doing so
  _triggerPreload(channelIndex) {
    const ch = this.channels[channelIndex]
    if (ch.preloading || ch.nextBuffer) return
    const cb = this.onNeedPreload[channelIndex]
    if (!cb) return
    ch.preloading = true
    Promise.resolve(cb(channelIndex)).then(({ buffer, bpm, offsetSec }) => {
      if (!ch.preloading) return  // cancelled (channel stopped)
      ch.nextBuffer  = buffer
      ch.nextBpm     = bpm
      ch.nextOffset  = Math.max(0, Math.floor((offsetSec || 0) * buffer.sampleRate))
      ch.preloading  = false
    }).catch(() => { ch.preloading = false })
  }

  // Stop a channel
  stop(channelIndex) {
    const ch = this.channels[channelIndex]
    if (!ch) return
    ch.active      = false
    ch.buffer      = null
    ch.offset      = 0
    ch.nextBuffer  = null
    ch.nextBpm     = null
    ch.nextOffset  = 0
    ch.preloading  = false
    this.onTrackEnded[channelIndex]  = null
    this.onNeedPreload[channelIndex] = null
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'stop-channel', channel: channelIndex })
    }
  }

  stopBuffer(channelIndex) { this.stop(channelIndex) }

  // ── Used by GridTool for direct deck control ──────────────────────────────

  // Returns a GainNode connected to the master analyser (for GridTool deck faders)
  createDeckGain() {
    if (!this.audioContext) return null
    const gn = this.audioContext.createGain()
    gn.connect(this.masterAnalyser)
    return gn
  }

  // Play a decoded buffer through a caller-supplied GainNode directly (GridTool).
  playBufferDirect(buffer, gainNode, when = null, offset = 0, playbackRate = 1) {
    if (!this.audioContext || !gainNode) return null
    const ctx       = this.audioContext
    const startTime = when !== null ? when : ctx.currentTime + 0.05
    const source    = ctx.createBufferSource()
    source.buffer   = buffer
    source.playbackRate.value = playbackRate
    source.connect(gainNode)
    source.start(startTime, offset)
    return { source, startTime }
  }

  // Drift-corrected wait — resolves within ~6ms of target ctx time
  waitUntil(targetCtxTime) {
    return new Promise(r => {
      const check = () => {
        const ms = (targetCtxTime - this.audioContext.currentTime) * 1000
        if (ms <= 6) return r()
        setTimeout(check, Math.max(4, ms - 6))
      }
      check()
    })
  }

  // ── Channel controls ──────────────────────────────────────────────────────

  setChannelVolume(channelIndex, value) {
    if (!this.workletNode) return
    this.workletNode.port.postMessage({ type: 'set-gain', channel: channelIndex, value })
  }

  setChannelGainDirect(channelIndex, gain) { this.setChannelVolume(channelIndex, gain) }

  setChannelEQ(channelIndex, low, mid, high) {
    if (!this.workletNode) return
    this.workletNode.port.postMessage({ type: 'set-eq', channel: channelIndex, low, mid, high })
  }

  setChannelCompression(channelIndex, threshold, ratio) {
    if (!this.workletNode) return
    this.workletNode.port.postMessage({ type: 'set-compression', channel: channelIndex, threshold, ratio })
  }

  // ── Meters ────────────────────────────────────────────────────────────────

  onMeterUpdate(callback) { this.meterCallback = callback }
  onMeter(callback)       { this.meterCallback = callback }

  getMasterRMS() {
    if (!this.masterAnalyser) return [0, 0]
    const data = new Uint8Array(this.masterAnalyser.frequencyBinCount)
    this.masterAnalyser.getByteTimeDomainData(data)
    let sumL = 0, sumR = 0
    const half = data.length / 2
    for (let i = 0;    i < half; i++) sumL += (data[i] - 128) ** 2
    for (let i = half; i < data.length; i++) sumR += (data[i] - 128) ** 2
    return [Math.sqrt(sumL / half) / 128, Math.sqrt(sumR / half) / 128]
  }

  // ── No-ops kept for API compat ────────────────────────────────────────────

  onChannelError() {}
  releaseWakeLock() {
    if (this._wakeLock) { try { this._wakeLock.release() } catch {} this._wakeLock = null }
  }

  destroy() {
    for (let i = 0; i < 16; i++) this.stop(i)
    if (this.workletNode)   { this.workletNode.disconnect();   this.workletNode   = null }
    if (this.dryGain)       { this.dryGain.disconnect();       this.dryGain       = null }
    if (this.wetGain)       { this.wetGain.disconnect();       this.wetGain       = null }
    if (this.convolver)     { this.convolver.disconnect();     this.convolver     = null }
    if (this.masterAnalyser){ this.masterAnalyser.disconnect();this.masterAnalyser = null }
    if (this.audioContext)  { this.audioContext.close();       this.audioContext   = null }
    this.wasmReady = false
    this.releaseWakeLock()
  }
}

const audioManager = new AudioManager()
export default audioManager
