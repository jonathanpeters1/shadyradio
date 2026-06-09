#include "engine.h"
#include <cmath>
#include <cstring>
#include <algorithm>

// External beat tracker functions
extern float get_channel_bpm(int channel);
extern float get_channel_phrase_phase(int channel);
extern int get_channel_bpm_locked(int channel);

namespace {
  static const int MAX_CHANNELS = 16;
  static const int ENERGY_HISTORY_SIZE = 8;
  static const float PHRASE_TRIGGER_THRESHOLD = 0.875f; // Last 1 bar of phrase
  static const int BARS_PER_CROSSFADE = 8;
  static const int BEATS_PER_BAR = 4;
  static const float ENERGY_HIGH_THRESHOLD = 0.6f;
  static const float ENERGY_LOW_THRESHOLD = 0.5f;
  static const int HIGH_ENERGY_PERSISTENCE = 3; // Need 3 consecutive high-energy channels
  static const float VARIETY_LOOKBACK = 4.0f;    // 4 tracks back
  static const float ENERGY_MATCH_WINDOW = 0.2f; // ±0.2 tolerance

  // Crossfade states
  enum CrossfadeState {
    IDLE = 0,
    CUEING = 1,
    CROSSFADING = 2
  };

  // Per-channel musical key (Camelot wheel 1A-12B, stored as 0-23)
  // For now, keys are randomly assigned or could be loaded from metadata
  static int g_channel_keys[MAX_CHANNELS] = {
    0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7,
    12, 17, 22, 15  // Second set of keys for channels 12-15
  };

  // Channel energy history for scoring
  struct EnergyHistory {
    float energies[ENERGY_HISTORY_SIZE];
    int index = 0;
    int count = 0;
    float current_avg = 0.0f;

    void push(float energy) {
      energies[index] = energy;
      index = (index + 1) % ENERGY_HISTORY_SIZE;
      if (count < ENERGY_HISTORY_SIZE) count++;

      // Update average
      float sum = 0.0f;
      for (int i = 0; i < count; i++) {
        sum += energies[i];
      }
      current_avg = (count > 0) ? sum / count : 0.0f;
    }

    float get_avg() const { return current_avg; }
  };

  // Channel play history for variety scoring
  struct PlayHistory {
    int channels[MAX_CHANNELS];
    float timestamps[MAX_CHANNELS];
    int index = 0;
    int count = 0;

    void record(int channel, float time) {
      channels[index] = channel;
      timestamps[index] = time;
      index = (index + 1) % MAX_CHANNELS;
      if (count < MAX_CHANNELS) count++;
    }

    bool played_recently(int channel, float current_time, float lookback_seconds) const {
      for (int i = 0; i < count; i++) {
        int idx = (index - 1 - i + MAX_CHANNELS) % MAX_CHANNELS;
        if (channels[idx] == channel) {
          if (current_time - timestamps[idx] < lookback_seconds) {
            return true;
          }
        }
      }
      return false;
    }
  };

  // Global automix state
  struct AutomixState {
    int active_channel = 0;
    int pending_channel = -1;
    CrossfadeState crossfade_state = IDLE;
    float crossfade_progress = 0.0f;

    EnergyHistory energy_history;
    PlayHistory play_history;

    // Energy planning state
    float high_energy_duration = 0.0f;  // How long we've been in high energy
    float low_energy_duration = 0.0f;   // How long we've been in low energy
    int consecutive_high_count = 0;
    int consecutive_low_count = 0;
    bool needs_energy_shift = false;
    bool prefer_high_energy = false;

    // Crossfade timing
    float crossfade_start_time = 0.0f;
    float crossfade_duration = 0.0f;

    // Sample counter for timing
    int samples_processed = 0;
    int sample_rate = 44100;
  };

  static AutomixState g_automix;
  static float g_channel_rms[MAX_CHANNELS] = {};
  static float g_channel_gains[MAX_CHANNELS] = {}; // Automix-controlled gains (0.0-1.0)
  static float g_channel_active[MAX_CHANNELS] = {}; // Whether channel is in the mix

  // Helper: Camelot wheel harmonic compatibility (0.0-1.0)
  // Keys stored as 0-23 (1A=0, 1B=1, 2A=2, ..., 12B=23)
  float harmonic_compatibility(int key1, int key2) {
    // If either key is unknown, give neutral score
    if (key1 < 0 || key2 < 0) return 0.5f;

    // Convert to wheel position (0-11 for A/B separately)
    int a1 = key1 / 2;  // 0-11 position on wheel
    int b1 = key1 % 2;  // 0=A, 1=B (major/minor)
    int a2 = key2 / 2;
    int b2 = key2 % 2;

    // Distance on wheel (circular)
    int dist = std::abs(a1 - a2);
    dist = std::min(dist, 12 - dist);

    // Same key
    if (key1 == key2) return 1.0f;

    // Relative major/minor (same wheel number, different mode)
    if (a1 == a2 && b1 != b2) return 0.85f;

    // Adjacent on wheel (same mode)
    if (dist == 1 && b1 == b2) return 0.80f;

    // Adjacent, different mode
    if (dist == 1) return 0.65f;

    // Two steps apart
    if (dist == 2) return 0.40f;

    // Everything else
    return 0.10f;
  }

  // Helper: Get current time in seconds
  float get_current_time() {
    return g_automix.samples_processed / static_cast<float>(g_automix.sample_rate);
  }
}

// Initialize automix system
void init_automix(int sample_rate, int buffer_size) {
  g_automix = AutomixState();
  g_automix.sample_rate = sample_rate;
  g_automix.active_channel = 0;
  g_automix.pending_channel = -1;
  g_automix.crossfade_state = IDLE;
  g_automix.crossfade_progress = 0.0f;

  for (int i = 0; i < MAX_CHANNELS; i++) {
    g_channel_rms[i] = 0.0f;
    g_channel_gains[i] = (i == 0) ? 1.0f : 0.0f; // Start with channel 0 active
    g_channel_active[i] = 0.0f;
  }
  g_channel_active[0] = 1.0f;
}

// Reset automix
void reset_automix() {
  init_automix(g_automix.sample_rate, 128);
}

// Set channel key (for harmonic compatibility)
void set_channel_key(int channel, int camelot_key) {
  if (channel >= 0 && channel < MAX_CHANNELS && camelot_key >= 0 && camelot_key < 24) {
    g_channel_keys[channel] = camelot_key;
  }
}

// Get channel key
int get_channel_key(int channel) {
  if (channel >= 0 && channel < MAX_CHANNELS) {
    return g_channel_keys[channel];
  }
  return 0;
}

// Score a candidate channel for mixing
float score_channel(int candidate, int current, float current_time) {
  float score = 0.0f;

  // Veto: if candidate BPM is not locked, score = 0
  if (!get_channel_bpm_locked(candidate)) {
    return 0.0f;
  }

  // Also veto if current channel BPM not locked (can't determine phrase alignment)
  if (!get_channel_bpm_locked(current)) {
    return 0.0f;
  }

  // === ENERGY MATCH (0.25 weight) ===
  float current_energy = g_automix.energy_history.get_avg();
  float candidate_energy = g_channel_rms[candidate];
  float energy_diff = std::abs(candidate_energy - current_energy);
  float energy_score = (energy_diff < ENERGY_MATCH_WINDOW) ? 1.0f :
                       (energy_diff < ENERGY_MATCH_WINDOW * 2.0f) ? 0.5f : 0.2f;

  // Apply energy planning bonus/penalty
  if (g_automix.needs_energy_shift) {
    if (g_automix.prefer_high_energy && candidate_energy > ENERGY_HIGH_THRESHOLD) {
      energy_score += 0.4f;
    } else if (!g_automix.prefer_high_energy && candidate_energy < ENERGY_LOW_THRESHOLD) {
      energy_score += 0.4f;
    }
  }

  score += std::min(energy_score, 1.0f) * 0.25f;

  // === HARMONIC COMPATIBILITY (0.30 weight) ===
  float harmonic_score = harmonic_compatibility(g_channel_keys[current], g_channel_keys[candidate]);
  score += harmonic_score * 0.30f;

  // === TEMPO PROXIMITY (0.25 weight) ===
  float current_bpm = get_channel_bpm(current);
  float candidate_bpm = get_channel_bpm(candidate);
  float bpm_diff = std::abs(candidate_bpm - current_bpm);
  float tempo_score = (bpm_diff < 4.0f) ? 1.0f :
                     (bpm_diff < 8.0f) ? 0.5f : 0.1f;
  score += tempo_score * 0.25f;

  // === VARIETY (0.20 weight) ===
  float variety_score = g_automix.play_history.played_recently(candidate, current_time, VARIETY_LOOKBACK * 30.0f)
                         ? 0.0f : 1.0f; // Assume ~30 seconds per track on average
  score += variety_score * 0.20f;

  return score;
}

// Select next channel based on scoring
int select_next_channel(int current) {
  float current_time = get_current_time();
  float best_score = -1.0f;
  int best_candidate = -1;

  for (int i = 0; i < MAX_CHANNELS; i++) {
    if (i == current) continue;
    if (!g_channel_active[i]) continue; // Skip inactive channels

    float score = score_channel(i, current, current_time);
    if (score > best_score) {
      best_score = score;
      best_candidate = i;
    }
  }

  return best_candidate;
}

// Update energy planning state
void update_energy_planning() {
  float current_energy = g_automix.energy_history.get_avg();

  // Track consecutive high/low energy
  if (current_energy > ENERGY_HIGH_THRESHOLD) {
    g_automix.consecutive_high_count++;
    g_automix.consecutive_low_count = 0;
  } else if (current_energy < ENERGY_LOW_THRESHOLD) {
    g_automix.consecutive_low_count++;
    g_automix.consecutive_high_count = 0;
  } else {
    // In the middle - reset both
    g_automix.consecutive_high_count = 0;
    g_automix.consecutive_low_count = 0;
  }

  // Determine if we need an energy shift
  g_automix.needs_energy_shift = false;
  if (g_automix.consecutive_high_count >= HIGH_ENERGY_PERSISTENCE) {
    g_automix.needs_energy_shift = true;
    g_automix.prefer_high_energy = false; // Need lower energy next
  } else if (g_automix.consecutive_low_count >= HIGH_ENERGY_PERSISTENCE) {
    g_automix.needs_energy_shift = true;
    g_automix.prefer_high_energy = true; // Need higher energy next
  }
}

// Execute crossfade logic
void execute_crossfade(float current_time) {
  switch (g_automix.crossfade_state) {
    case IDLE:
      // Check if we should start a crossfade
      if (g_automix.pending_channel >= 0) {
        float phrase_phase = get_channel_phrase_phase(g_automix.active_channel);
        if (phrase_phase > PHRASE_TRIGGER_THRESHOLD) {
          // Start crossfade
          g_automix.crossfade_state = CROSSFADING;
          g_automix.crossfade_start_time = current_time;

          // Calculate duration: 8 bars at current BPM
          float bpm = get_channel_bpm(g_automix.active_channel);
          float beat_duration = 60.0f / bpm;
          float bar_duration = beat_duration * BEATS_PER_BAR;
          g_automix.crossfade_duration = bar_duration * BARS_PER_CROSSFADE;

          g_automix.crossfade_progress = 0.0f;

          // Activate pending channel
          g_channel_active[g_automix.pending_channel] = 1.0f;
        }
      }
      break;

    case CROSSFADING: {
      // Update crossfade progress
      float elapsed = current_time - g_automix.crossfade_start_time;
      g_automix.crossfade_progress = std::min(1.0f, elapsed / g_automix.crossfade_duration);

      // Equal-power cosine crossfade
      float t = g_automix.crossfade_progress * static_cast<float>(M_PI) / 2.0f;
      float current_gain = std::cos(t);  // Outgoing: 1.0 -> 0.0
      float incoming_gain = std::sin(t); // Incoming: 0.0 -> 1.0

      g_channel_gains[g_automix.active_channel] = current_gain;
      g_channel_gains[g_automix.pending_channel] = incoming_gain;

      // EQ carve during crossfade
      // Incoming channel: low_shelf -8dB -> 0dB over first half
      // Outgoing channel: high_shelf 0dB -> -6dB over second half
      // These would modify channel EQ parameters, but we'll use EQ from filters.cpp
      // For now, the gain curve provides the main crossfade effect

      // Check if crossfade is complete
      if (g_automix.crossfade_progress >= 1.0f) {
        // Crossfade complete
        g_channel_gains[g_automix.active_channel] = 0.0f;
        g_channel_active[g_automix.active_channel] = 0.0f;

        // Record play history
        g_automix.play_history.record(g_automix.active_channel, current_time);

        // Switch active channel
        g_automix.active_channel = g_automix.pending_channel;
        g_automix.pending_channel = -1;
        g_automix.crossfade_state = IDLE;
        g_automix.crossfade_progress = 0.0f;

        // New active channel at full gain
        g_channel_gains[g_automix.active_channel] = 1.0f;
      }
      break;
    }

    case CUEING:
      // CUEING state - not currently used but could preload next track
      break;
  }
}

// Process automix for one buffer
// Called every 4 bars to evaluate next channel
void process_automix(const float* channel_rms, int num_channels, int samples_processed) {
  g_automix.samples_processed += samples_processed;
  float current_time = get_current_time();

  // Update channel RMS values
  for (int i = 0; i < num_channels && i < MAX_CHANNELS; i++) {
    g_channel_rms[i] = channel_rms[i];
  }

  // Update energy history
  float current_energy = g_channel_rms[g_automix.active_channel];
  g_automix.energy_history.push(current_energy);

  // Update energy planning
  update_energy_planning();

  // Execute crossfade if in progress
  execute_crossfade(current_time);

  // Check if we need to select a new pending channel
  // This happens when we're in IDLE and phrase phase is approaching threshold
  if (g_automix.crossfade_state == IDLE && g_automix.pending_channel < 0) {
    float phrase_phase = get_channel_phrase_phase(g_automix.active_channel);
    // Start looking for next channel when we're past 50% of phrase
    if (phrase_phase > 0.5f) {
      int next = select_next_channel(g_automix.active_channel);
      if (next >= 0) {
        g_automix.pending_channel = next;
      }
    }
  }
}

// Get automix-controlled gain for a channel
float get_automix_gain(int channel) {
  if (channel >= 0 && channel < MAX_CHANNELS) {
    return g_channel_gains[channel];
  }
  return 0.0f;
}

// Set channel as active (called when user enables a channel)
void set_channel_automix_active(int channel, int active) {
  if (channel >= 0 && channel < MAX_CHANNELS) {
    g_channel_active[channel] = active ? 1.0f : 0.0f;
  }
}

// Force a crossfade to a specific channel (manual DJ takeover)
void force_crossfade_to(int target_channel) {
  if (target_channel < 0 || target_channel >= MAX_CHANNELS) return;
  if (target_channel == g_automix.active_channel) return;
  if (!g_channel_active[target_channel]) return;

  // Start crossfade immediately
  g_automix.pending_channel = target_channel;
  g_automix.crossfade_state = CROSSFADING;
  g_automix.crossfade_start_time = get_current_time();

  // Calculate duration
  float bpm = get_channel_bpm(g_automix.active_channel);
  if (bpm < 1.0f) bpm = 120.0f;
  float beat_duration = 60.0f / bpm;
  float bar_duration = beat_duration * BEATS_PER_BAR;
  g_automix.crossfade_duration = bar_duration * 2.0f; // Shorter for manual: 2 bars

  g_automix.crossfade_progress = 0.0f;
  g_channel_active[target_channel] = 1.0f;
}

// Get current active channel
int get_active_channel() {
  return g_automix.active_channel;
}

// Get current pending channel
int get_pending_channel() {
  return g_automix.pending_channel;
}

// Get crossfade progress
float get_crossfade_progress() {
  return g_automix.crossfade_progress;
}

// Get crossfade state
int get_crossfade_state() {
  return static_cast<int>(g_automix.crossfade_state);
}
