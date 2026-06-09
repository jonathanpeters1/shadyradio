#include "engine.h"
#include <cstring>
#include <cmath>

// Internal EQ functions from filters.cpp
extern void init_eq_system(int sample_rate);
extern float process_channel_eq(int channel, float sample);
extern void reset_channel_eq(int channel);

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
  
  // Initialize EQ system
  init_eq_system(sample_rate);
}

void process_audio() {
  // Process all active channels through EQ, then sum to stereo
  for (int s = 0; s < g_buffer_size; s++) {
    float sumL = 0, sumR = 0;
    for (int ch = 0; ch < 16; ch++) {
      if (!g_active[ch]) continue;
      
      // Apply EQ to the input sample
      float sample = process_channel_eq(ch, g_input[ch * g_buffer_size + s]);
      
      // Apply gain and sum to stereo
      sample = sample * g_gain[ch];
      sumL += sample * 0.5f;
      sumR += sample * 0.5f;
    }
    g_output[s]                 = tanhf(sumL * 1.5f) / tanhf(1.5f); // soft clip
    g_output[g_buffer_size + s] = tanhf(sumR * 1.5f) / tanhf(1.5f);
  }
  // compute per-channel RMS (post-EQ)
  for (int ch = 0; ch < 16; ch++) {
    float rms = 0;
    for (int s = 0; s < g_buffer_size; s++) {
      float x = process_channel_eq(ch, g_input[ch * g_buffer_size + s]);
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
float get_channel_bpm(int ch)          { return 120.0f; }
float get_channel_beat_phase(int ch)   { return 0.0f; }
float get_channel_phrase_phase(int ch) { return 0.0f; }
int   get_channel_bpm_locked(int ch)   { return 0; }