// SF Engine AudioWorklet — loads WASM DSP engine, processes 16 channels
let wasm = null
let wasmReady = false
let inputPtr = 0, outputPtr = 0, meterPtr = 0
let bufferSize = 128

class SFEngineProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.frameCount = 0
    this.port.onmessage = (e) => {
      if (e.data.type === 'init-wasm') {
        WebAssembly.instantiate(e.data.buffer, {
          env: {
            memory: new WebAssembly.Memory({ initial: 256 }),
            emscripten_resize_heap: () => {},
          },
          wasi_snapshot_preview1: { proc_exit: () => {} },
        }).then(result => {
          wasm = result.instance.exports
          wasm._init_engine(sampleRate, bufferSize)
          inputPtr  = wasm._get_input_buffer()
          outputPtr = wasm._get_output_buffer()
          meterPtr  = wasm._get_meter_buffer()
          wasmReady = true
          this.port.postMessage({ type: 'ready' })
        }).catch(err => {
          this.port.postMessage({ type: 'error', message: err.message })
        })
      }
      if (e.data.type === 'set-active')  wasm?._set_channel_active(e.data.channel, e.data.value)
      if (e.data.type === 'set-gain')    wasm?._set_channel_gain(e.data.channel, e.data.value)
      if (e.data.type === 'set-eq')      wasm?._set_channel_eq(e.data.channel, e.data.low, e.data.mid, e.data.high)
    }
  }

  process(inputs, outputs, parameters) {
    if (!wasmReady) return true

    const input = inputs[0]
    const output = outputs[0]
    if (!input || !output) return true

    const heap = new Uint8Array(wasm.env.memory.buffer)
    const heap32 = new Float32Array(wasm.env.memory.buffer)
    const inOff = inputPtr >> 2
    const outOff = outputPtr >> 2

    // Copy input channels to WASM (16 channels max)
    for (let ch = 0; ch < 16; ch++) {
      const inputChannel = input[ch]
      if (inputChannel) {
        for (let i = 0; i < bufferSize; i++) {
          heap32[inOff + ch * bufferSize + i] = inputChannel[i]
        }
      } else {
        // Silence missing channels
        for (let i = 0; i < bufferSize; i++) {
          heap32[inOff + ch * bufferSize + i] = 0
        }
      }
    }

    // Process audio through WASM
    wasm._process_audio()

    // Copy output from WASM to AudioWorklet outputs (stereo)
    const outL = output[0]
    const outR = output[1]
    if (outL) outL.set(heap32.subarray(outOff, outOff + bufferSize))
    if (outR) outR.set(heap32.subarray(outOff + bufferSize, outOff + bufferSize * 2))

    // Post meter values at ~60fps (every 3 buffers at 44.1k/128)
    this.frameCount++
    if (this.frameCount % 3 === 0) {
      const mOff = meterPtr >> 2
      const meters = Array.from(heap32.subarray(mOff, mOff + 20))
      this.port.postMessage({ type: 'meter', values: meters })
    }

    return true
  }
}

registerProcessor('sf-engine', SFEngineProcessor)