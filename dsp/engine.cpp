#include "engine.h"
#include <cstring>
#include <cmath>

static int   g_sample_rate  = 44100;
static int   g_buffer_size  = 128;
static float g_input[16 * 128]  = {};
static float g_output[2  * 128] = {};
static float g_meter[20]        = {};
static float g_gain[16];
static int   g_active[16];

void init_engine(int sample_rate, int buffer_size) {
  g_sample_rate = sample_rate;
  g_buffer_size = buffer_size;
  for (int i = 0; i < 16; i++) { g_gain[i] = 1.0f; g_active[i] = 0; }
}

void process_audio() {
  // STUB: sum all active channels to stereo, compute RMS meter per channel
  for (int s = 0; s < g_buffer_size; s++) {
    float sumL = 0, sumR = 0;
    for (int ch = 0; ch < 16; ch++) {
      if (!g_active[ch]) continue;
      float sample = g_input[ch * g_buffer_size + s] * g_gain[ch];
      sumL += sample * 0.5f;
      sumR += sample * 0.5f;
    }
    g_output[s]                 = tanhf(sumL * 1.5f) / tanhf(1.5f); // soft clip
    g_output[g_buffer_size + s] = tanhf(sumR * 1.5f) / tanhf(1.5f);
  }
  // compute per-channel RMS
  for (int ch = 0; ch < 16; ch++) {
    float rms = 0;
    for (int s = 0; s < g_buffer_size; s++) {
      float x = g_input[ch * g_buffer_size + s];
      rms += x * x;
    }
    g_meter[ch] = sqrtf(rms / g_buffer_size);
  }
  g_meter[16] = 0;  // active channel
  g_meter[17] = -1; // pending channel
  g_meter[18] = 0;  // crossfade progress
  g_meter[19] = 120.0f; // BPM placeholder
}

float* get_input_buffer()  { return g_input; }
float* get_output_buffer() { return g_output; }
float* get_meter_buffer()  { return g_meter; }

void set_channel_active(int ch, int active) { if (ch>=0&&ch<16) g_active[ch]=active; }
void set_channel_gain(int ch, float gain)   { if (ch>=0&&ch<16) g_gain[ch]=gain; }
void set_channel_eq(int ch, float lo, float mid, float hi) {}

float get_channel_bpm(int ch)          { return 120.0f; }
float get_channel_beat_phase(int ch)   { return 0.0f; }
float get_channel_phrase_phase(int ch) { return 0.0f; }
int   get_channel_bpm_locked(int ch)   { return 0; }