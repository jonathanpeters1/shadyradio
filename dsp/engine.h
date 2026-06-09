#pragma once
#ifdef __cplusplus
extern "C" {
#endif

void  init_engine(int sample_rate, int buffer_size);
void  process_audio();
float* get_input_buffer();   // 16 * buffer_size floats
float* get_output_buffer();  // 2  * buffer_size floats (stereo L+R)
float* get_meter_buffer();   // 20 floats: [0-15]=channel RMS, [16]=active_ch,
                               // [17]=pending_ch, [18]=xfade_progress, [19]=active_bpm

void set_channel_active(int channel, int active);   // 1=active, 0=inactive
void set_channel_gain(int channel, float gain);     // 0.0–1.0
void set_channel_eq(int channel, float low_db, float mid_db, float high_db);
void set_channel_compression(int channel, float threshold_db, float ratio);

float get_channel_bpm(int channel);
float get_channel_beat_phase(int channel);    // 0.0–1.0 within current beat
float get_channel_phrase_phase(int channel);  // 0.0–1.0 within 8-bar phrase
int   get_channel_bpm_locked(int channel);    // 1 if stable

#ifdef __cplusplus
}
#endif