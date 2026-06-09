# CLAUDE.md — ShadyRadio Web App

## This is the app

**Vite + React PWA** — 16-channel speaker grid, Shady AI character, C++/WASM DSP engine.
Runs on iPhone, Android, desktop browser.

```bash
cd /Users/jp/shadyradio/web
npx vite --host          # localhost:3000
```

GitHub: https://github.com/jonathanpeters1/shadyradio

---

## Key files

| File | Role |
|------|------|
| `src/components/SoundSystem.jsx` | Main UI — all state, all logic |
| `src/components/SoundSystem.css` | All layout + visual styles |
| `src/components/SpeakerCell.jsx` | Speaker tile — cone pump animation, glow |
| `src/audio/audioManager.js` | AudioContext bridge — worklet, WASM, channels |
| `public/audio/engine.worklet.js` | AudioWorklet (MUST stay in public/ — Vite must NOT transform it) |
| `public/dsp/engine.wasm` | Compiled C++ DSP engine (31KB) |
| `src/components/SFParticleField.jsx` | Particle field + SF logo ↔ lip morph |
| `src/components/ShadyStage.jsx` | Flying word animations when Shady speaks |
| `src/components/ShadyProps.jsx` | Fan snap drag queen animation |
| `src/components/ProPanel.jsx` | Slide-up 16-ch mixer with EQ |
| `src/components/DiagPanel.jsx` | Dev diagnostic overlay (tap logo 5×) |
| `worker/src/index.js` | Cloudflare Worker — R2 audio streaming API |

---

## Audio chain (fully wired)

```
tapGenre(slug)
  → channelIndex = GENRES.findIndex(slug)   // 0–15
  → fetchR2Track(slug)                       // R2 first
  → fetchStreamUrls(slug)                   // Radio Browser fallback
  → audioManager.play(channelIndex, url)
      → HTMLAudioElement → createMediaElementSource
      → connect to AudioWorkletNode (input channel = channelIndex)
      → WASM DSP: EQ → compressor → automix crossfade
      → masterAnalyser → destination
```

Meter bridge: worklet posts 20 floats at 60fps:
- `[0–15]` = per-channel RMS
- `[16]` = active channel index
- `[17]` = pending channel index
- `[18]` = crossfade progress (0–1)
- `[19]` = active BPM

---

## Shady AI

- Based on Xander C. Gaines (House of Aviance, NYC door legend)
- Drag queen persona — sharp reads, ballroom vernacular, Spanglish, dry humor
- Dev: proxied via Vite → `192.168.1.167:8099` (Mac Pro must be running)
- Prod: `VITE_SHADY_URL` in `.env.production` → Cloudflare Tunnel URL
- Chat: `POST /api/shady` → `/shady`
- TTS: `POST /api/synthesize` → `/synthesize` → audio blob → plays via audioManager.getContext()

---

## Production blockers (not yet deployed)

- `.env.production` needs real Cloudflare Tunnel URL for Shady
- `worker/wrangler.toml` needs real R2 public bucket URL for audio

---

## Rules

- Dark aesthetic — no polish, no cheese, underground NYC energy
- Shady is a real person in the UI — never break character
- Do NOT add max-width constraints — speakers must feel organic and full-bleed
- Do NOT simplify or stub real code
- AudioWorklet file MUST stay in `public/audio/` — never move to `src/`
