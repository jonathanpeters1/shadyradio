#include "engine.h"
#include <cmath>
#include <cstring>

namespace {
  // Constants
  static const int MAX_CHANNELS = 16;
  static const int LOOKAHEAD_SAMPLES = 220; // ~5ms at 44.1kHz
  static const float PI = 3.14159265358979323846f;
  
  // Global state
  static int g_sample_rate = 44100;
  static int g_buffer_size = 128;
  
  // Per-channel compressor state
  struct ChannelCompressor {
    float envelope = 0.0f;           // RMS envelope follower
    float gain_reduction = 1.0f;    // Current gain reduction
    float threshold_db = -18.0f;    // Threshold in dB
    float ratio = 4.0f;             // Compression ratio
    float attack_coeff = 0.0f;      // Attack coefficient
    float release_coeff = 0.0f;     // Release coefficient
    float knee_width = 6.0f;        // Soft knee width in dB
    
    // RMS window buffer
    float* rms_buffer = nullptr;
    int rms_buffer_size = 0;
    int rms_buffer_index = 0;
    
    void set_coefficients(int sample_rate) {
      float attack_time = 0.010f;  // 10ms
      float release_time = 0.150f; // 150ms
      
      attack_coeff = std::exp(-1.0f / (sample_rate * attack_time));
      release_coeff = std::exp(-1.0f / (sample_rate * release_time));
      
      // RMS window: 50ms
      rms_buffer_size = static_cast<int>(sample_rate * 0.050f);
    }
    
    float process_sample(float input) {
      // RMS detection
      float input_sq = input * input;
      
      // Update envelope
      float target_envelope = (input_sq > envelope) ? input_sq : envelope;
      envelope = target_envelope + (envelope - target_envelope) * 
                 ((input_sq > envelope) ? attack_coeff : release_coeff);
      
      float rms_db = 10.0f * std::log10(std::max(envelope, 1e-10f));
      
      // Compute gain reduction with soft knee
      float over_threshold = rms_db - threshold_db;
      float gain_reduction_db = 0.0f;
      
      if (over_threshold <= -knee_width / 2.0f) {
        gain_reduction_db = 0.0f;
      } else if (over_threshold > knee_width / 2.0f) {
        gain_reduction_db = over_threshold * (1.0f - 1.0f / ratio);
      } else {
        // Soft knee region
        float x = over_threshold + knee_width / 2.0f;
        gain_reduction_db = (x * x) / (knee_width * ratio);
      }
      
      // Apply gain reduction
      float gain_linear = std::pow(10.0f, -gain_reduction_db / 20.0f);
      gain_reduction = gain_linear;
      
      return input * gain_linear;
    }
    
    void reset() {
      envelope = 0.0f;
      gain_reduction = 1.0f;
      if (rms_buffer) {
        std::memset(rms_buffer, 0, rms_buffer_size * sizeof(float));
      }
      rms_buffer_index = 0;
    }
  };
  
  static ChannelCompressor g_compressors[MAX_CHANNELS];
  
  // Master limiter state
  struct MasterLimiter {
    float* delay_buffer = nullptr;      // Look-ahead delay line
    int delay_buffer_size = 0;
    int delay_buffer_index = 0;
    
    float envelope = 0.0f;
    float threshold_db = -1.0f;
    float release_coeff = 0.0f;
    
    void set_coefficients(int sample_rate) {
      delay_buffer_size = LOOKAHEAD_SAMPLES;
      float release_time = 0.050f; // 50ms
      release_coeff = std::exp(-1.0f / (sample_rate * release_time));
    }
    
    float process_sample(float input) {
      // Write to delay buffer
      delay_buffer[delay_buffer_index] = input;
      
      // Read from delay buffer (look-ahead)
      int read_index = (delay_buffer_index - LOOKAHEAD_SAMPLES + delay_buffer_size) % delay_buffer_size;
      float delayed_sample = delay_buffer[read_index];
      
      // Peak detection on delayed signal
      float peak = std::fabs(delayed_sample);
      float peak_db = 20.0f * std::log10(std::max(peak, 1e-10f));
      
      // Compute gain reduction
      float over_threshold = peak_db - threshold_db;
      float gain_reduction_db = std::max(0.0f, over_threshold);
      
      // Apply release smoothing
      float current_gr_db = -20.0f * std::log10(std::max(envelope, 1e-10f));
      float smoothed_gr_db = current_gr_db + (current_gr_db - current_gr_db) * release_coeff;
      envelope = std::pow(10.0f, -smoothed_gr_db / 20.0f);
      
      // Apply gain reduction to delayed sample
      float limited_sample = delayed_sample * envelope;
      
      // Advance delay buffer
      delay_buffer_index = (delay_buffer_index + 1) % delay_buffer_size;
      
      return limited_sample;
    }
    
    void reset() {
      envelope = 1.0f;
      if (delay_buffer) {
        std::memset(delay_buffer, 0, delay_buffer_size * sizeof(float));
      }
      delay_buffer_index = 0;
    }
  };
  
  static MasterLimiter g_master_limiter;
}

// Tanh soft clipper
inline float tanh_clip(float x, float drive = 1.5f) {
  return std::tanh(x * drive) / std::tanh(drive);
}

// Initialize dynamics system
void init_dynamics_system(int sample_rate, int buffer_size) {
  g_sample_rate = sample_rate;
  g_buffer_size = buffer_size;
  
  // Initialize per-channel compressors
  for (int i = 0; i < MAX_CHANNELS; i++) {
    g_compressors[i].set_coefficients(sample_rate);
    g_compressors[i].rms_buffer = new float[g_compressors[i].rms_buffer_size];
    g_compressors[i].reset();
  }
  
  // Initialize master limiter
  g_master_limiter.set_coefficients(sample_rate);
  g_master_limiter.delay_buffer = new float[g_master_limiter.delay_buffer_size];
  g_master_limiter.reset();
}

// Cleanup dynamics system
void cleanup_dynamics_system() {
  for (int i = 0; i < MAX_CHANNELS; i++) {
    delete[] g_compressors[i].rms_buffer;
    g_compressors[i].rms_buffer = nullptr;
  }
  delete[] g_master_limiter.delay_buffer;
  g_master_limiter.delay_buffer = nullptr;
}

// Process single channel through compressor
float process_channel_compressor(int channel, float sample) {
  if (channel < 0 || channel >= MAX_CHANNELS) return sample;
  return g_compressors[channel].process_sample(sample);
}

// Process master bus through limiter and soft clipper
float process_master_limiter(float sample) {
  float limited = g_master_limiter.process_sample(sample);
  return tanh_clip(limited, 1.5f);
}

// Set channel compression parameters (internal)
void set_channel_compression_internal(int channel, float threshold_db, float ratio) {
  if (channel < 0 || channel >= MAX_CHANNELS) return;
  g_compressors[channel].threshold_db = threshold_db;
  g_compressors[channel].ratio = ratio;
}

// Reset channel compressor state
void reset_channel_compressor(int channel) {
  if (channel < 0 || channel >= MAX_CHANNELS) return;
  g_compressors[channel].reset();
}

// Reset master limiter state
void reset_master_limiter() {
  g_master_limiter.reset();
}