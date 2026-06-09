#include "engine.h"
#include <cmath>

// RBJ Biquad Filter Implementation
// Based on Audio EQ Cookbook by Robert Bristow-Johnson

namespace {
  // Biquad filter coefficients and state
  struct Biquad {
    float b0, b1, b2;  // Numerator coefficients
    float a0, a1, a2;  // Denominator coefficients
    float x1, x2;      // Input state (delayed samples)
    float y1, y2;      // Output state (delayed samples)
    
    Biquad() : b0(1), b1(0), b2(0), a0(1), a1(0), a2(0), x1(0), x2(0), y1(0), y2(0) {}
    
    // Process single sample through biquad
    float process(float x) {
      float y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      return y;
    }
    
    // Reset filter state
    void reset() {
      x1 = x2 = y1 = y2 = 0;
    }
  };
  
  // 3-band EQ state per channel
  struct ChannelEQ {
    Biquad low_shelf;   // LOW band at 200Hz
    Biquad mid_peaking; // MID band at 1kHz
    Biquad high_shelf;  // HIGH band at 8kHz
    
    float low_gain_db;  // -12 to +6 dB
    float mid_gain_db;  // -12 to +6 dB
    float high_gain_db; // -12 to +6 dB
    
    ChannelEQ() : low_gain_db(0), mid_gain_db(0), high_gain_db(0) {}
    
    // Recalculate coefficients when gains change
    void update_coefficients(int sample_rate);
    
    // Process sample through all 3 bands
    float process(float x) {
      x = low_shelf.process(x);
      x = mid_peaking.process(x);
      x = high_shelf.process(x);
      return x;
    }
    
    // Reset all filter states
    void reset() {
      low_shelf.reset();
      mid_peaking.reset();
      high_shelf.reset();
    }
  };
  
  // Per-channel EQ storage
  static ChannelEQ g_channel_eq[16];
  static int g_sample_rate = 44100;
}

// RBJ coefficient calculations
namespace RBJ {
  // Helper: dB to linear amplitude (RBJ cookbook: A = 10^(dBgain/40) for shelves/peaking)
  inline float db_to_gain(float db) {
    return std::pow(10.0f, db / 40.0f);
  }
  
  // Helper: clamp value
  inline float clamp(float x, float min, float max) {
    return x < min ? min : (x > max ? max : x);
  }
  
  // Low shelf filter coefficients
  void low_shelf_coeff(float f0, float gain_db, float sample_rate,
                       float& b0, float& b1, float& b2, float& a0, float& a1, float& a2) {
    float A = db_to_gain(gain_db);
    float w0 = 2.0f * M_PI * f0 / sample_rate;
    float cos_w0 = std::cos(w0);
    float sin_w0 = std::sin(w0);
    float alpha = sin_w0 / 2.0f * std::sqrt((A + 1.0f / A) * (1.0f / 0.707f - 1.0f) + 2.0f);
    
    b0 = A * ((A + 1.0f) - (A - 1.0f) * cos_w0 + 2.0f * std::sqrt(A) * alpha);
    b1 = 2.0f * A * ((A - 1.0f) - (A + 1.0f) * cos_w0);
    b2 = A * ((A + 1.0f) - (A - 1.0f) * cos_w0 - 2.0f * std::sqrt(A) * alpha);
    a0 = (A + 1.0f) + (A - 1.0f) * cos_w0 + 2.0f * std::sqrt(A) * alpha;
    a1 = -2.0f * ((A - 1.0f) + (A + 1.0f) * cos_w0);
    a2 = (A + 1.0f) + (A - 1.0f) * cos_w0 - 2.0f * std::sqrt(A) * alpha;
  }
  
  // High shelf filter coefficients
  void high_shelf_coeff(float f0, float gain_db, float sample_rate,
                        float& b0, float& b1, float& b2, float& a0, float& a1, float& a2) {
    float A = db_to_gain(gain_db);
    float w0 = 2.0f * M_PI * f0 / sample_rate;
    float cos_w0 = std::cos(w0);
    float sin_w0 = std::sin(w0);
    float alpha = sin_w0 / 2.0f * std::sqrt((A + 1.0f / A) * (1.0f / 0.707f - 1.0f) + 2.0f);
    
    b0 = A * ((A + 1.0f) + (A - 1.0f) * cos_w0 + 2.0f * std::sqrt(A) * alpha);
    b1 = -2.0f * A * ((A - 1.0f) + (A + 1.0f) * cos_w0);
    b2 = A * ((A + 1.0f) + (A - 1.0f) * cos_w0 - 2.0f * std::sqrt(A) * alpha);
    a0 = (A + 1.0f) - (A - 1.0f) * cos_w0 + 2.0f * std::sqrt(A) * alpha;
    a1 = 2.0f * ((A - 1.0f) - (A + 1.0f) * cos_w0);
    a2 = (A + 1.0f) - (A - 1.0f) * cos_w0 - 2.0f * std::sqrt(A) * alpha;
  }
  
  // Peaking EQ coefficients
  void peaking_coeff(float f0, float gain_db, float Q, float sample_rate,
                     float& b0, float& b1, float& b2, float& a0, float& a1, float& a2) {
    float A = db_to_gain(gain_db);
    float w0 = 2.0f * M_PI * f0 / sample_rate;
    float cos_w0 = std::cos(w0);
    float sin_w0 = std::sin(w0);
    float alpha = sin_w0 / (2.0f * Q);
    
    b0 = 1.0f + alpha * A;
    b1 = -2.0f * cos_w0;
    b2 = 1.0f - alpha * A;
    a0 = 1.0f + alpha / A;
    a1 = -2.0f * cos_w0;
    a2 = 1.0f - alpha / A;
  }
  
  // Low pass filter coefficients
  void low_pass_coeff(float f0, float Q, float sample_rate,
                      float& b0, float& b1, float& b2, float& a0, float& a1, float& a2) {
    float w0 = 2.0f * M_PI * f0 / sample_rate;
    float cos_w0 = std::cos(w0);
    float sin_w0 = std::sin(w0);
    float alpha = sin_w0 / (2.0f * Q);
    
    b0 = (1.0f - cos_w0) / 2.0f;
    b1 = 1.0f - cos_w0;
    b2 = (1.0f - cos_w0) / 2.0f;
    a0 = 1.0f + alpha;
    a1 = -2.0f * cos_w0;
    a2 = 1.0f - alpha;
  }
  
  // High pass filter coefficients
  void high_pass_coeff(float f0, float Q, float sample_rate,
                       float& b0, float& b1, float& b2, float& a0, float& a1, float& a2) {
    float w0 = 2.0f * M_PI * f0 / sample_rate;
    float cos_w0 = std::cos(w0);
    float sin_w0 = std::sin(w0);
    float alpha = sin_w0 / (2.0f * Q);
    
    b0 = (1.0f + cos_w0) / 2.0f;
    b1 = -(1.0f + cos_w0);
    b2 = (1.0f + cos_w0) / 2.0f;
    a0 = 1.0f + alpha;
    a1 = -2.0f * cos_w0;
    a2 = 1.0f - alpha;
  }
}

// ChannelEQ method implementations
void ChannelEQ::update_coefficients(int sample_rate) {
  // Clamp gains to valid range
  low_gain_db = RBJ::clamp(low_gain_db, -12.0f, 6.0f);
  mid_gain_db = RBJ::clamp(mid_gain_db, -12.0f, 6.0f);
  high_gain_db = RBJ::clamp(high_gain_db, -12.0f, 6.0f);
  
  // LOW: low shelf at 200Hz
  RBJ::low_shelf_coeff(200.0f, low_gain_db, sample_rate,
                       low_shelf.b0, low_shelf.b1, low_shelf.b2,
                       low_shelf.a0, low_shelf.a1, low_shelf.a2);
  
  // MID: peaking at 1kHz, Q=0.7
  RBJ::peaking_coeff(1000.0f, mid_gain_db, 0.7f, sample_rate,
                     mid_peaking.b0, mid_peaking.b1, mid_peaking.b2,
                     mid_peaking.a0, mid_peaking.a1, mid_peaking.a2);
  
  // HIGH: high shelf at 8kHz
  RBJ::high_shelf_coeff(8000.0f, high_gain_db, sample_rate,
                        high_shelf.b0, high_shelf.b1, high_shelf.b2,
                        high_shelf.a0, high_shelf.a1, high_shelf.a2);
}

// Public API function (declared in engine.h)
void set_channel_eq(int channel, float low_db, float mid_db, float high_db) {
  if (channel < 0 || channel >= 16) return;
  
  g_channel_eq[channel].low_gain_db = low_db;
  g_channel_eq[channel].mid_gain_db = mid_db;
  g_channel_eq[channel].high_gain_db = high_db;
  g_channel_eq[channel].update_coefficients(g_sample_rate);
}

// Initialize EQ system (called from init_engine)
void init_eq_system(int sample_rate) {
  g_sample_rate = sample_rate;
  for (int i = 0; i < 16; i++) {
    g_channel_eq[i].update_coefficients(sample_rate);
  }
}

// Process single channel through EQ
float process_channel_eq(int channel, float sample) {
  if (channel < 0 || channel >= 16) return sample;
  return g_channel_eq[channel].process(sample);
}

// Reset EQ state for a channel (useful when switching tracks)
void reset_channel_eq(int channel) {
  if (channel < 0 || channel >= 16) return;
  g_channel_eq[channel].reset();
}