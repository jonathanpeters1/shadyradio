cmake_minimum_required(VERSION 3.10)
project(SFEngine)
set(CMAKE_CXX_STANDARD 17)

add_executable(engine
  engine.cpp filters.cpp dynamics.cpp mixer.cpp beat_tracker.cpp automix.cpp
)

set_target_properties(engine PROPERTIES
  COMPILE_FLAGS "-O3"
  LINK_FLAGS "-O3 -s WASM=1 -s EXPORTED_FUNCTIONS='[\"_init_engine\",\"_process_audio\",\"_get_input_buffer\",\"_get_output_buffer\",\"_get_meter_buffer\",\"_set_channel_active\",\"_set_channel_gain\",\"_set_channel_eq\",\"_get_channel_bpm\",\"_get_channel_beat_phase\",\"_get_channel_phrase_phase\",\"_get_channel_bpm_locked\"]' -s EXPORTED_RUNTIME_METHODS='[\"HEAPF32\",\"HEAP32\"]' -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=0 -o ../public/dsp/engine.js"
)