#include "engine.h"
#include <cstring>
#include <cmath>

// Internal EQ functions from filters.cpp
extern void init_eq_system(int sample_rate);
extern float process_channel_eq(int channel, float sample);
extern void reset_channel_eq(int channel);

// Internal dynamics functions
extern void init_dynamics_system(int sample_rate, int buffer_size);
extern float process_channel_compressor(int channel, float sample);
extern float process_master_limiter(float sample);
extern void cleanup_dynamics_system();
extern void set_channel_compression_internal(int channel, float threshold_db, float ratio);

// Internal beat tracker functions
extern void init_beat_tracker(int sample_rate, int buffer_size);
extern void process_beat_tracker(int channel, const float* samples, int num_samples);
extern void reset_beat_tracker(int channel);

// Internal automix functions
extern void init_automix(int sample_rate, int buffer_size);
extern void process_automix(const float* channel_rms, int num_channels, int samples_processed);
extern float get_automix_gain(int channel);
extern void set_channel_automix_active(int channel, int active);
extern int get_active_channel();
extern int get_pending_channel();
extern float get_crossfade_progress();
extern int get_crossfade_state();

static int   g_sample_rate  = 44100;
static int   g_buffer_size  = 128;
static float g_input[16 * 128]  = {};
static float g_output[2  * 128] = {};
static float g_meter[20]        = {};
static float g_gain[16];
static int   g_active[16];

// Use Emscripten's EMSCRIPTEN_KEEPALIVE macro for exported functions
#include <emscripten.h>

extern "C" {

EMSCRIPTEN_KEEPALIVE
void init_engine(int sample_rate, int buffer_size) {
  g_sample_rate = sample_rate;
  g_buffer_size = buffer_size;
  for (int i = 0; i < 16; i++) { g_gain[i] = 1.0f; g_active[i] = 0; }

  // Initialize EQ system
  init_eq_system(sample_rate);

  // Initialize dynamics system
  init_dynamics_system(sample_rate, buffer_size);

  // Initialize beat tracking system
  init_beat_tracker(sample_rate, buffer_size);

  // Initialize automix system
  init_automix(sample_rate, buffer_size);
}

EMSCRIPTEN_KEEPALIVE
void process_audio() {
  // Process beat tracking for all channels (on raw input before EQ)
  for (int ch = 0; ch < 16; ch++) {
    if (!g_active[ch]) continue;
    process_beat_tracker(ch, g_input + ch * g_buffer_size, g_buffer_size);
  }

  // Process all active channels through EQ, compression, and automix, then sum to stereo
  for (int s = 0; s < g_buffer_size; s++) {
    float sumL = 0, sumR = 0;
    for (int ch = 0; ch < 16; ch++) {
      if (!g_active[ch]) continue;

      // Apply EQ to the input sample
      float sample = process_channel_eq(ch, g_input[ch * g_buffer_size + s]);

      // Apply per-channel compression
      sample = process_channel_compressor(ch, sample);

      // Apply automix crossfade gain + user channel gain
      float automix_gain = get_automix_gain(ch);
      sample = sample * g_gain[ch] * automix_gain;

      // Sum to stereo
      sumL += sample * 0.5f;
      sumR += sample * 0.5f;
    }
    // Apply master limiting and soft clipping
    g_output[s]                 = process_master_limiter(sumL);
    g_output[g_buffer_size + s] = process_master_limiter(sumR);
  }
  // compute per-channel RMS (post-EQ, pre-compression for metering)
  // Note: EQ already applied in main mix loop above, meter from processed signal
  float channel_rms[16];
  for (int ch = 0; ch < 16; ch++) {
    float rms = 0;
    for (int s = 0; s < g_buffer_size; s++) {
      float x = g_input[ch * g_buffer_size + s];
      rms += x * x;
    }
    channel_rms[ch] = sqrtf(rms / g_buffer_size);
    g_meter[ch] = channel_rms[ch];
  }

  // Process automix decision engine
  process_automix(channel_rms, 16, g_buffer_size);

  // Update meter data for automix visibility
  g_meter[16] = static_cast<float>(get_active_channel());
  g_meter[17] = static_cast<float>(get_pending_channel());
  g_meter[18] = get_crossfade_progress();

  int active_ch = get_active_channel();
  if (active_ch >= 0 && active_ch < 16) {
    g_meter[19] = get_channel_bpm(active_ch);
  }
}

EMSCRIPTEN_KEEPALIVE
float* get_input_buffer() { return g_input; }

EMSCRIPTEN_KEEPALIVE
float* get_output_buffer() { return g_output; }

EMSCRIPTEN_KEEPALIVE
float* get_meter_buffer() { return g_meter; }

EMSCRIPTEN_KEEPALIVE
void set_channel_active(int ch, int active) {
  if (ch>=0&&ch<16) {
    g_active[ch]=active;
    set_channel_automix_active(ch, active);
  }
}

EMSCRIPTEN_KEEPALIVE
void set_channel_gain(int ch, float gain) { if (ch>=0&&ch<16) g_gain[ch]=gain; }

EMSCRIPTEN_KEEPALIVE
void set_channel_compression(int ch, float threshold_db, float ratio) {
  if (ch >= 0 && ch < 16) {
    set_channel_compression_internal(ch, threshold_db, ratio);
  }
}

} // extern "C"

// get_channel_bpm, get_channel_beat_phase, get_channel_phrase_phase, get_channel_bpm_locked
// are implemented in beat_tracker.cpp

// External seed function (beat_tracker.cpp)
extern void seed_beat_tracker_bpm(int channel, float bpm);

// Pre-analyzed key hints (automix.cpp)
extern int get_channel_key(int channel);
extern void set_channel_key(int channel, int camelot_key);
extern void set_automix_bypass_internal(int bypass);

static float g_channel_bpm_hint[16] = {};  // 0 = no hint

// Global key hint array - defined here, accessed by automix.cpp
int g_channel_key_hint[16] = {};  // -1 = unknown, accessible to automix.cpp

// Global downbeat grid storage (per channel)
#include <vector>
static std::vector<float> g_channel_downbeats[16];  // downbeat times in seconds

extern "C" {

EMSCRIPTEN_KEEPALIVE
void set_channel_bpm(int ch, float bpm) {
  if (ch < 0 || ch >= 16) return;
  g_channel_bpm_hint[ch] = bpm;
  // Seed the beat tracker with the known BPM so it locks immediately
  if (bpm >= 60.0f && bpm <= 200.0f) {
    seed_beat_tracker_bpm(ch, bpm);
  }
}

EMSCRIPTEN_KEEPALIVE
void set_channel_key(int ch, int camelot_key) {
  if (ch < 0 || ch >= 16) return;
  g_channel_key_hint[ch] = camelot_key;
}

EMSCRIPTEN_KEEPALIVE
int get_channel_key_hint(int ch) {
  if (ch < 0 || ch >= 16) return -1;
  return g_channel_key_hint[ch];
}

EMSCRIPTEN_KEEPALIVE
void set_automix_bypass(int bypass) {
  set_automix_bypass_internal(bypass);
}

EMSCRIPTEN_KEEPALIVE
void set_channel_downbeats(int ch, const float* downbeats_sec, int count) {
  if (ch < 0 || ch >= 16) return;
  g_channel_downbeats[ch].clear();
  g_channel_downbeats[ch].reserve(count);
  for (int i = 0; i < count; i++) {
    g_channel_downbeats[ch].push_back(downbeats_sec[i]);
  }
}

EMSCRIPTEN_KEEPALIVE
int get_channel_downbeat_count(int ch) {
  if (ch < 0 || ch >= 16) return 0;
  return static_cast<int>(g_channel_downbeats[ch].size());
}

EMSCRIPTEN_KEEPALIVE
float get_channel_downbeat_at(int ch, int index) {
  if (ch < 0 || ch >= 16) return 0.0f;
  if (index < 0 || index >= static_cast<int>(g_channel_downbeats[ch].size())) return 0.0f;
  return g_channel_downbeats[ch][index];
}

} // extern "C"