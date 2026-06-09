// SF Engine AudioWorklet — loads WASM DSP engine, processes 16 channels
// PCM architecture: JS pushes decoded Float32 chunks into per-channel ring buffers;
// process() reads from rings → WASM input buffer → WASM → output.

let wasm        = null
let wasmReady   = false
let inputPtr    = 0, outputPtr = 0, meterPtr = 0
const bufferSize = 128

// Per-channel ring buffers (16 channels × 65536 samples each)
const RING_SIZE  = 65536
const rings      = Array.from({ length: 16 }, () => new Float32Array(RING_SIZE))
const ringWrite  = new Int32Array(16)   // write head
const ringRead   = new Int32Array(16)   // read head
const RING_LOW   = 8192                 // request refill below this

let heapView         = null
let lastMemoryBuffer = null

class SFEngineProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.frameCount = 0

    this.port.onmessage = (e) => {
      const d = e.data

      // ── boot WASM ──────────────────────────────────────────────────────────
      if (d.type === 'init-wasm') {
        WebAssembly.instantiate(d.buffer, {
          env: {
            memory: new WebAssembly.Memory({ initial: 256 }),
            emscripten_resize_heap: () => {},
          },
          wasi_snapshot_preview1: { proc_exit: () => {} },
        }).then(result => {
          wasm      = result.instance.exports
          wasm._init_engine(sampleRate, bufferSize)
          inputPtr  = wasm._get_input_buffer()
          outputPtr = wasm._get_output_buffer()
          meterPtr  = wasm._get_meter_buffer()
          wasmReady = true
          this.port.postMessage({ type: 'wasm-ready' })  // matches audioManager
        }).catch(err => {
          this.port.postMessage({ type: 'error', message: err.message })
        })
        return
      }

      // ── PCM push from JS ───────────────────────────────────────────────────
      if (d.type === 'push-pcm') {
        const ch  = d.channel
        const pcm = d.pcm                   // Float32Array (transferred)
        const w   = ringWrite[ch]
        for (let i = 0; i < pcm.length; i++) {
          rings[ch][(w + i) & (RING_SIZE - 1)] = pcm[i]
        }
        ringWrite[ch] = (w + pcm.length) & (RING_SIZE - 1)
        return
      }

      // ── stop a channel ────────────────────────────────────────────────────
      if (d.type === 'stop-channel') {
        const ch    = d.channel
        ringWrite[ch] = 0
        ringRead[ch]  = 0
        rings[ch].fill(0)
        wasm?._set_channel_active(ch, 0)
        return
      }

      // ── WASM control messages ─────────────────────────────────────────────
      if (d.type === 'set-active')      wasm?._set_channel_active(d.channel, d.value)
      if (d.type === 'set-gain')        wasm?._set_channel_gain(d.channel, d.value)
      if (d.type === 'set-eq')          wasm?._set_channel_eq(d.channel, d.low, d.mid, d.high)
      if (d.type === 'set-compression') wasm?._set_channel_compression(d.channel, d.threshold, d.ratio)
      if (d.type === 'set-bpm-hint')    wasm?._set_channel_bpm(d.channel, d.value)
      if (d.type === 'set-key-hint')    wasm?._set_channel_key(d.channel, d.value)
    }
  }

  process(_inputs, outputs) {
    if (!wasmReady) return true

    const output = outputs[0]
    if (!output) return true

    // Refresh heap view if WASM memory grew
    if (wasm.memory.buffer !== lastMemoryBuffer) {
      heapView         = new Float32Array(wasm.memory.buffer)
      lastMemoryBuffer = wasm.memory.buffer
    }
    const heap = heapView
    const inOff  = inputPtr  >> 2
    const outOff = outputPtr >> 2

    // ── fill WASM input from ring buffers ────────────────────────────────
    for (let ch = 0; ch < 16; ch++) {
      const avail = (ringWrite[ch] - ringRead[ch] + RING_SIZE) & (RING_SIZE - 1)
      const base  = inOff + ch * bufferSize
      if (avail >= bufferSize) {
        let r = ringRead[ch]
        for (let s = 0; s < bufferSize; s++) {
          heap[base + s] = rings[ch][r]
          r = (r + 1) & (RING_SIZE - 1)
        }
        ringRead[ch] = r

        // Ask JS for more if ring is running low
        const remaining = (ringWrite[ch] - r + RING_SIZE) & (RING_SIZE - 1)
        if (remaining < RING_LOW) {
          this.port.postMessage({ type: 'need-more', channel: ch })
        }
      } else {
        // Underrun — silence this channel's input
        heap.fill(0, base, base + bufferSize)
      }
    }

    // ── run WASM DSP ──────────────────────────────────────────────────────
    wasm._process_audio()

    // ── copy stereo output ────────────────────────────────────────────────
    const outL = output[0]
    const outR = output[1]
    if (outL) outL.set(heap.subarray(outOff,              outOff + bufferSize))
    if (outR) outR.set(heap.subarray(outOff + bufferSize, outOff + bufferSize * 2))

    // ── meters at ~60 fps ─────────────────────────────────────────────────
    this.frameCount++
    if (this.frameCount % 3 === 0) {
      const mOff   = meterPtr >> 2
      const meters = Array.from(heap.subarray(mOff, mOff + 20))
      this.port.postMessage({ type: 'meters', meters })  // matches audioManager
    }

    return true
  }
}

registerProcessor('sf-engine', SFEngineProcessor)
