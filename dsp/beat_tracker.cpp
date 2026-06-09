#include "engine.h"
#include <cmath>
#include <cstring>
#include <algorithm>

namespace {
  static const int MAX_CHANNELS = 16;
  static const int SAMPLE_RATE = 44100;
  static const float HOP_SIZE_MS = 10.0f;
  static const int HOP_SIZE_SAMPLES = static_cast<int>(SAMPLE_RATE * HOP_SIZE_MS / 1000.0f); // 441 samples
  static const int ONSET_BUFFER_SIZE = 400; // 4 seconds worth of onsets (at 10ms hops, but we store timestamps)
  static const int FLUX_HISTORY_SIZE = 40;  // Last 40 hops for median calculation
  static const int BPM_EMA_SECONDS = 4;     // 4-second EMA for BPM smoothing
  static const float BPM_LOCK_THRESHOLD = 2.0f; // BPM variance threshold for locking
  static const float IOI_MIN_S = 0.375f;      // 160 BPM max
  static const float IOI_MAX_S = 0.75f;       // 80 BPM min
  static const int BEATS_PER_BAR = 4;
  static const int BARS_PER_PHRASE = 8;

  // Per-channel beat tracker state
  struct BeatTracker {
    // Onset detection state
    float prev_energy = 0.0f;
    float flux_history[FLUX_HISTORY_SIZE] = {};
    int flux_index = 0;
    float onset_times[ONSET_BUFFER_SIZE] = {};
    int onset_index = 0;
    int onset_count = 0;
    float last_onset_time = 0.0f;

    // BPM estimation state
    float bpm_estimate = 120.0f;
    float bpm_ema = 120.0f;
    float bpm_variance = 999.0f;
    float bpm_history[100] = {}; // Last ~10 seconds of BPM estimates
    int bpm_history_index = 0;
    int bpm_history_count = 0;
    bool bpm_locked = false;

    // Phase tracking state
    float beat_phase = 0.0f;
    float bar_phase = 0.0f;
    float phrase_phase = 0.0f;
    int beat_index = 0;  // 0-3 within bar
    int bar_index = 0;   // 0-7 within phrase
    float last_beat_time = 0.0f;

    // Sample counter for timing
    int samples_processed = 0;
  };

  static BeatTracker g_trackers[MAX_CHANNELS];
  static int g_sample_rate = SAMPLE_RATE;
  static int g_hop_size = HOP_SIZE_SAMPLES;

  // Helper: Compute median of array
  float compute_median(float* arr, int count) {
    if (count <= 0) return 0.0f;
    float sorted[FLUX_HISTORY_SIZE];
    std::memcpy(sorted, arr, count * sizeof(float));
    std::sort(sorted, sorted + count);
    if (count % 2 == 0) {
      return (sorted[count / 2 - 1] + sorted[count / 2]) * 0.5f;
    } else {
      return sorted[count / 2];
    }
  }

  // Helper: Find most common IOI from onset times using autocorrelation
  float estimate_bpm_from_onsets(const float* onset_times, int count, float current_time) {
    if (count < 2) return 120.0f;

    // Build onset signal (impulse train)
    static const int ACORR_SIZE = 400; // 4 seconds at 10ms resolution
    float onset_signal[ACORR_SIZE] = {};
    float window_start = current_time - 8.0f; // 8-second window

    for (int i = 0; i < count; i++) {
      int idx = static_cast<int>((onset_times[i] - window_start) * 100.0f); // 10ms resolution
      if (idx >= 0 && idx < ACORR_SIZE) {
        onset_signal[idx] = 1.0f;
      }
    }

    // Autocorrelation to find periodicity
    float best_score = 0.0f;
    float best_lag = 0.0f;

    int min_lag = static_cast<int>(IOI_MIN_S * 100.0f); // 37.5 samples (at 10ms)
    int max_lag = static_cast<int>(IOI_MAX_S * 100.0f); // 75 samples

    for (int lag = min_lag; lag <= max_lag; lag++) {
      float score = 0.0f;
      for (int i = lag; i < ACORR_SIZE; i++) {
        score += onset_signal[i] * onset_signal[i - lag];
      }
      if (score > best_score) {
        best_score = score;
        best_lag = static_cast<float>(lag);
      }
    }

    if (best_score < 1.0f) return 120.0f; // No clear periodicity

    // Convert lag (in 10ms units) to BPM
    float ioi_seconds = best_lag * 0.01f; // Convert from 10ms units to seconds
    float bpm = 60.0f / ioi_seconds;
    return bpm;
  }

  // Process a single hop for onset detection
  void process_hop(BeatTracker& tracker, const float* samples, int num_samples, float current_time) {
    // Compute RMS energy for this hop
    float energy = 0.0f;
    for (int i = 0; i < num_samples; i++) {
      energy += samples[i] * samples[i];
    }
    energy = std::sqrt(energy / num_samples);

    // Spectral flux proxy: half-wave rectifier on energy derivative
    float energy_diff = energy - tracker.prev_energy;
    float flux = (energy_diff > 0.0f) ? energy_diff : 0.0f;
    tracker.prev_energy = energy;

    // Update flux history
    tracker.flux_history[tracker.flux_index] = flux;
    tracker.flux_index = (tracker.flux_index + 1) % FLUX_HISTORY_SIZE;

    // Compute adaptive threshold
    int flux_count = std::min(FLUX_HISTORY_SIZE, tracker.samples_processed / g_hop_size + 1);
    float median_flux = compute_median(tracker.flux_history, flux_count);
    float threshold = median_flux * 1.4f;

    // Onset detection
    if (flux > threshold && flux > 0.001f) { // Minimum flux to avoid noise
      // Debounce: ensure at least 150ms between onsets (max ~300 BPM detection)
      if (current_time - tracker.last_onset_time > 0.15f) {
        tracker.onset_times[tracker.onset_index] = current_time;
        tracker.onset_index = (tracker.onset_index + 1) % ONSET_BUFFER_SIZE;
        if (tracker.onset_count < ONSET_BUFFER_SIZE) tracker.onset_count++;
        tracker.last_onset_time = current_time;
      }
    }
  }

  // Update BPM estimate from recent onsets
  void update_bpm(BeatTracker& tracker, float current_time) {
    if (tracker.onset_count < 4) return; // Need at least 4 onsets

    // Clean old onsets (older than 8 seconds)
    int valid_count = 0;
    float valid_onsets[ONSET_BUFFER_SIZE];
    for (int i = 0; i < tracker.onset_count; i++) {
      int idx = (tracker.onset_index - 1 - i + ONSET_BUFFER_SIZE) % ONSET_BUFFER_SIZE;
      if (current_time - tracker.onset_times[idx] < 8.0f) {
        valid_onsets[valid_count++] = tracker.onset_times[idx];
      }
    }

    if (valid_count < 4) return;

    // Sort onsets chronologically
    std::sort(valid_onsets, valid_onsets + valid_count);

    // Estimate BPM from autocorrelation
    float new_bpm = estimate_bpm_from_onsets(valid_onsets, valid_count, current_time);

    // Validate BPM is in reasonable range
    if (new_bpm < 60.0f || new_bpm > 200.0f) return;

    // Update EMA
    float alpha = 0.1f; // Smoothing factor (roughly 4-second time constant at typical hop rates)
    tracker.bpm_ema = tracker.bpm_ema * (1.0f - alpha) + new_bpm * alpha;
    tracker.bpm_estimate = tracker.bpm_ema;

    // Update BPM history for variance calculation
    tracker.bpm_history[tracker.bpm_history_index] = tracker.bpm_estimate;
    tracker.bpm_history_index = (tracker.bpm_history_index + 1) % 100;
    if (tracker.bpm_history_count < 100) tracker.bpm_history_count++;

    // Calculate BPM variance over last 8 seconds
    if (tracker.bpm_history_count >= 80) { // At least 8 seconds of data
      float mean = 0.0f;
      int count = std::min(80, tracker.bpm_history_count);
      for (int i = 0; i < count; i++) {
        int idx = (tracker.bpm_history_index - 1 - i + 100) % 100;
        mean += tracker.bpm_history[idx];
      }
      mean /= count;

      float variance = 0.0f;
      for (int i = 0; i < count; i++) {
        int idx = (tracker.bpm_history_index - 1 - i + 100) % 100;
        float diff = tracker.bpm_history[idx] - mean;
        variance += diff * diff;
      }
      variance /= count;
      tracker.bpm_variance = std::sqrt(variance);

      // Lock BPM if variance is low enough
      tracker.bpm_locked = (tracker.bpm_variance < BPM_LOCK_THRESHOLD);
    }
  }

  // Update phase tracking
  void update_phase(BeatTracker& tracker, float current_time) {
    if (!tracker.bpm_locked || tracker.bpm_estimate < 1.0f) return;

    float beat_duration = 60.0f / tracker.bpm_estimate;
    float bar_duration = beat_duration * BEATS_PER_BAR;
    float phrase_duration = bar_duration * BARS_PER_PHRASE;

    // Time since last detected onset
    float time_since_onset = current_time - tracker.last_onset_time;

    // Beat phase: cycles 0.0 -> 1.0 within each beat
    tracker.beat_phase = std::fmod(time_since_onset, beat_duration) / beat_duration;
    if (tracker.beat_phase < 0.0f) tracker.beat_phase += 1.0f;

    // Estimate beat index from onset history
    if (tracker.last_beat_time == 0.0f || current_time - tracker.last_beat_time >= beat_duration * 0.9f) {
      // Try to align to detected onsets
      if (time_since_onset < 0.05f) { // Within 50ms of an onset = new beat
        tracker.beat_index = (tracker.beat_index + 1) % BEATS_PER_BAR;
        if (tracker.beat_index == 0) {
          tracker.bar_index = (tracker.bar_index + 1) % BARS_PER_PHRASE;
        }
        tracker.last_beat_time = current_time;
      }
    }

    // Bar phase: 0.0 -> 1.0 within bar
    tracker.bar_phase = (tracker.beat_index + tracker.beat_phase) / BEATS_PER_BAR;

    // Phrase phase: 0.0 -> 1.0 within 8-bar phrase (this is KEY for automix)
    tracker.phrase_phase = (tracker.bar_index + tracker.bar_phase) / BARS_PER_PHRASE;
  }
}

// Initialize beat tracking system
void init_beat_tracker(int sample_rate, int buffer_size) {
  g_sample_rate = sample_rate;
  g_hop_size = static_cast<int>(sample_rate * HOP_SIZE_MS / 1000.0f);

  for (int i = 0; i < MAX_CHANNELS; i++) {
    g_trackers[i] = BeatTracker();
    g_trackers[i].samples_processed = 0;
  }
}

// Process audio buffer for beat tracking
void process_beat_tracker(int channel, const float* samples, int num_samples) {
  if (channel < 0 || channel >= MAX_CHANNELS) return;

  BeatTracker& tracker = g_trackers[channel];

  // Process in 10ms hops
  int samples_remaining = num_samples;
  int sample_offset = 0;

  while (samples_remaining > 0) {
    int hop_samples = std::min(g_hop_size, samples_remaining);
    float current_time = tracker.samples_processed / static_cast<float>(g_sample_rate);

    process_hop(tracker, samples + sample_offset, hop_samples, current_time);
    update_bpm(tracker, current_time);
    update_phase(tracker, current_time);

    tracker.samples_processed += hop_samples;
    sample_offset += hop_samples;
    samples_remaining -= hop_samples;
  }
}

// Reset beat tracker for a channel
void reset_beat_tracker(int channel) {
  if (channel < 0 || channel >= MAX_CHANNELS) return;
  g_trackers[channel] = BeatTracker();
}

// Get BPM estimate for channel
float get_channel_bpm(int channel) {
  if (channel < 0 || channel >= MAX_CHANNELS) return 120.0f;
  return g_trackers[channel].bpm_estimate;
}

// Get beat phase (0.0-1.0 within current beat)
float get_channel_beat_phase(int channel) {
  if (channel < 0 || channel >= MAX_CHANNELS) return 0.0f;
  return g_trackers[channel].beat_phase;
}

// Get phrase phase (0.0-1.0 within 8-bar phrase)
float get_channel_phrase_phase(int channel) {
  if (channel < 0 || channel >= MAX_CHANNELS) return 0.0f;
  return g_trackers[channel].phrase_phase;
}

// Get BPM locked status
int get_channel_bpm_locked(int channel) {
  if (channel < 0 || channel >= MAX_CHANNELS) return 0;
  return g_trackers[channel].bpm_locked ? 1 : 0;
}

// Seed beat tracker with known BPM (from pre-analyzed metadata)
// Allows instant lock without 8-10 second warmup
void seed_beat_tracker_bpm(int channel, float bpm) {
  if (channel < 0 || channel >= MAX_CHANNELS) return;
  if (bpm < 60.0f || bpm > 200.0f) return;
  BeatTracker& t = g_trackers[channel];
  t.bpm_estimate  = bpm;
  t.bpm_ema       = bpm;
  t.bpm_variance  = 0.5f;   // Below lock threshold — instant lock
  t.bpm_locked    = true;
  // Seed history so variance stays low
  for (int i = 0; i < 80 && i < 100; i++) t.bpm_history[i] = bpm;
  t.bpm_history_count = 80;
}
