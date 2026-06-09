// AudioWorklet processor for sample-accurate crossfading
class CrossfaderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sampleCounter = 0;
    this.crossfadeStart = null;
    this.crossfadeDuration = null;
    this.crossfading = false;
  }

  static get parameterDescriptors() {
    return [];
  }

  process(inputs, outputs, parameters) {
    const inputA = inputs[0];
    const inputB = inputs[1];
    const output = outputs[0];

    if (!inputA || !inputB || !output) {
      return true;
    }

    const channels = output.length;
    const samples = output[0].length;

    for (let channel = 0; channel < channels; channel++) {
      const inputAChannel = inputA[channel] || new Float32Array(samples);
      const inputBChannel = inputB[channel] || new Float32Array(samples);
      const outputChannel = output[channel];

      for (let i = 0; i < samples; i++) {
        const currentSample = this.sampleCounter + i;
        let gainA = 1.0;
        let gainB = 0.0;

        if (this.crossfading && this.crossfadeStart !== null && this.crossfadeDuration !== null) {
          if (currentSample >= this.crossfadeStart) {
            const progress = Math.min(1, (currentSample - this.crossfadeStart) / this.crossfadeDuration);
            // Sigmoid crossfade curve for smooth transition
            const sigmoid = 1 / (1 + Math.exp(-10 * (progress - 0.5)));
            gainA = 1 - sigmoid;
            gainB = sigmoid;

            // Check if crossfade is complete
            if (progress >= 1) {
              this.crossfading = false;
              this.port.postMessage({ type: 'done' });
            }
          }
        }

        outputChannel[i] = inputAChannel[i] * gainA + inputBChannel[i] * gainB;
      }
    }

    this.sampleCounter += samples;
    return true;
  }
}

registerProcessor('crossfader-processor', CrossfaderProcessor);