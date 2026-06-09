#pragma once
#ifdef __cplusplus
extern "C" {
#endif

void  init_engine(int sample_rate, int buffer_size) __attribute__((export_name("_init_engine")));
void  process_audio() __attribute__((export_name("_process_audio")));
float* get_input_buffer() __attribute__((export_name("_get_input_buffer")));   // 16 * buffer_size floats
float* get_output_buffer() __attribute__((export_name("_get_output_buffer")));  // 2  * buffer_size floats (stereo L+R)
float* get_meter_buffer() __attribute__((export_name("_get_meter_buffer")));   // 20 floats: [0-15]=channel RMS, [16]=active_ch,
                               // [17]=pending_ch, [18]=xfade_progress, [19]=active_bpm

void set_channel_active(int channel, int active) __attribute__((export_name("_set_channel_active")));   // 1=active, 0=inactive
void set_channel_gain(int channel, float gain) __attribute__((export_name("_set_channel_gain")));     // 0.0–1.0
void set_channel_eq(int channel, float low_db, float mid_db, float high_db) __attribute__((export_name("_set_channel_eq")));
void set_channel_compression(int channel, float threshold_db, float ratio) __attribute__((export_name("_set_channel_compression")));

float get_channel_bpm(int channel) __attribute__((export_name("_get_channel_bpm")));
float get_channel_beat_phase(int channel) __attribute__((export_name("_get_channel_beat_phase")));    // 0.0–1.0 within current beat
float get_channel_phrase_phase(int channel) __attribute__((export_name("_get_channel_phrase_phase")));  // 0.0–1.0 within 8-bar phrase
int   get_channel_bpm_locked(int channel) __attribute__((export_name("_get_channel_bpm_locked")));    // 1 if stable

// Pre-analyzed BPM/key hints (from manifest.json)
void  set_channel_bpm(int channel, float bpm) __attribute__((export_name("_set_channel_bpm")));       // seed beat tracker with known BPM
void  set_channel_key(int channel, int camelot_key) __attribute__((export_name("_set_channel_key")));  // set Camelot key (0-23 encoded)
int   get_channel_key_hint(int channel) __attribute__((export_name("_get_channel_key_hint")));              // get stored key

#ifdef __cplusplus
}
#endif
