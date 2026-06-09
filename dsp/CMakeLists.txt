cmake_minimum_required(VERSION 3.10)
project(SFEngine)
set(CMAKE_CXX_STANDARD 17)

add_executable(engine
  engine.cpp filters.cpp dynamics.cpp mixer.cpp beat_tracker.cpp automix.cpp
)

# Emscripten-specific compile and link flags
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -O3")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -O3")

# Linker flags for Emscripten (use SHELL: prefix for complex flags)
# Note: Functions marked with EMSCRIPTEN_KEEPALIVE don't need to be in EXPORTED_FUNCTIONS
target_link_options(engine PRIVATE
  -O3
  "SHELL:-s WASM=1"
  "SHELL:-s EXPORTED_RUNTIME_METHODS=[HEAPF32,HEAP32]"
  "SHELL:-s ALLOW_MEMORY_GROWTH=1"
  "SHELL:-s MODULARIZE=0"
  "SHELL:-o ../public/dsp/engine.js"
)
