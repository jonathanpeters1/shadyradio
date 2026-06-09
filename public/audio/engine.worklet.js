// SF Engine AudioWorklet — WASM DSP mixer, 16 channels
// Audio is fed via port messages (push-PCM) — no AudioWorklet inputs needed.
// Each channel has a ring buffer; process() drains 128 samples per call.

let wasm = null
let wasmReady = false
let inputPtr = 0, outputPtr = 0, meterPtr = 0
const bufferSize = 128
let heapView = null
let lastMemoryBuffer = null

// Per-channel ring buffers (Float32, 65536 samples each — ~1.5s at 44100)
// write/read are monotonically increasing; only % RING_SIZE when indexing buf.
const RING_SIZE = 65536
const rings = Array.from({ length: 16 }, () => ({
  buf: new Float32Array(RING_SIZE),
  write: 0,   // total samples written (never wrapped)
  read: 0,    // total samples read    (never wrapped)
  active: false,
}))

function ringAvailable(r) {
  return r.write - r.read
}

function ringPush(r, data) {
  for (let i = 0; i < data.length; i++) {
    r.buf[r.write & (RING_SIZE - 1)] = data[i]
    r.write++
  }
}

function ringPop(r, out) {
  const avail = r.write - r.read
  if (avail === 0) { out.fill(0); return }
  const n = Math.min(out.length, avail)
  for (let i = 0; i < n; i++) {
    out[i] = r.buf[r.read & (RING_SIZE - 1)]
    r.read++
  }
  if (n < out.length) out.fill(0, n)
}

class SFEngineProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.frameCount = 0
    this.port.onmessage = (e) => {
      const d = e.data
      switch (d.type) {
        case 'init-wasm':
          WebAssembly.instantiate(d.buffer, {
            env: {
              memory: new WebAssembly.Memory({ initial: 256 }),
              emscripten_resize_heap: () => {},
              emscripten_notify_memory_growth: () => {},
            },
            wasi_snapshot_preview1: { proc_exit: () => {} },
          }).then(result => {
            wasm = result.instance.exports
            wasm._init_engine(sampleRate, bufferSize)
            inputPtr  = wasm._get_input_buffer()
            outputPtr = wasm._get_output_buffer()
            meterPtr  = wasm._get_meter_buffer()
            wasmReady = true
            this.port.postMessage({ type: 'wasm-ready' })
          }).catch(err => {
            this.port.postMessage({ type: 'error', message: err.message })
          })
          break

        // Push decoded PCM for a channel (Float32Array, mono, resampled to ctx SR)
        case 'push-pcm': {
          const r = rings[d.channel]
          if (r) {
            // Transfer ownership of the ArrayBuffer for zero-copy
            const f32 = d.pcm instanceof Float32Array ? d.pcm : new Float32Array(d.pcm)
            ringPush(r, f32)
            r.active = true
          }
          break
        }

        case 'stop-channel': {
          const r = rings[d.channel]
          if (r) { r.write = 0; r.read = 0; r.active = false }
          if (wasm) wasm._set_channel_active(d.channel, 0)
          break
        }

        case 'set-active':       wasm?._set_channel_active(d.channel, d.value); break
        case 'set-gain':         wasm?._set_channel_gain(d.channel, d.value); break
        case 'set-eq':           wasm?._set_channel_eq(d.channel, d.low, d.mid, d.high); break
        case 'set-compression':  wasm?._set_channel_compression(d.channel, d.threshold, d.ratio); break
        case 'set-bpm-hint':     wasm?._set_channel_bpm(d.channel, d.value); break
        case 'set-key-hint':     wasm?._set_channel_key(d.channel, d.value); break
        case 'reset-beat-tracker': wasm?._reset_beat_tracker(d.channel); break
      }
    }
  }

  process(inputs, outputs) {
    if (!wasmReady) return true

    const output = outputs[0]
    if (!output) return true

    if (wasm.memory.buffer !== lastMemoryBuffer) {
      heapView = new Float32Array(wasm.memory.buffer)
      lastMemoryBuffer = wasm.memory.buffer
    }
    const heap = heapView
    const inOff = inputPtr >> 2
    const outOff = outputPtr >> 2

    // Drain each ring buffer into WASM input
    const tmp = new Float32Array(bufferSize)
    for (let ch = 0; ch < 16; ch++) {
      const r = rings[ch]
      if (r.active && ringAvailable(r) >= bufferSize) {
        ringPop(r, tmp)
        heap.set(tmp, inOff + ch * bufferSize)
        const avail = ringAvailable(r)
        if (avail < 8192) {
          this.port.postMessage({ type: 'need-more', channel: ch })
        }
        if (avail < bufferSize * 2) {
          this.port.postMessage({ type: 'log', msg: `ch${ch} ring CRITICAL: ${avail} samples left` })
        }
      } else {
        if (r.active) {
          this.port.postMessage({ type: 'log', msg: `ch${ch} UNDERRUN active=${r.active} avail=${ringAvailable(r)}` })
          r.active = false  // stop spamming once empty
        }
        heap.fill(0, inOff + ch * bufferSize, inOff + (ch + 1) * bufferSize)
      }
    }

    // Run WASM DSP
    wasm._process_audio()

    // Copy stereo output
    const outL = output[0]
    const outR = output[1] || output[0]
    if (outL) outL.set(heap.subarray(outOff, outOff + bufferSize))
    if (outR) outR.set(heap.subarray(outOff + bufferSize, outOff + bufferSize * 2))

    // Meters at ~60fps
    this.frameCount++
    if (this.frameCount % 3 === 0) {
      const mOff = meterPtr >> 2
      this.port.postMessage({ type: 'meters', meters: Array.from(heap.subarray(mOff, mOff + 20)) })
    }

    return true
  }
}

registerProcessor('sf-engine', SFEngineProcessor)
