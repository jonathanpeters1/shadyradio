# CLAUDE.md — ShadyRadio Web App (THE MAIN FRONT END)

## This is the app

**Vite + React PWA** — 16-channel speaker grid, Shady AI character, hero stage.
Runs on iPhone, Android, browser. Deployed via `npx vite --host`.

```bash
cd /Users/jp/shadyradio/web
npx vite --host          # local: localhost:3000 / network: 192.168.1.153:3000
```

Also lives at: `/Users/jp/Desktop/shadyradio/web/` (same copy)
GitHub: https://github.com/jonathanpeters1/shadyradio

---

## Key files

| File | Role |
|------|------|
| `src/components/SoundSystem.jsx` | Main UI — 16 speakers, hero stage, Shady chat, all state |
| `src/components/SoundSystem.css` | All layout + visual styles |
| `src/components/SpeakerCell.jsx` | Individual speaker tile with woofer animation |
| `src/components/SFParticleField.jsx` | Particle field + SF logo ↔ lip morph |
| `src/components/ShadyStage.jsx` | Flying word animations when Shady speaks |
| `src/components/ShadyProps.jsx` | Fan snap drag queen animation |
| `src/components/SFCamera.jsx` | Camera feed layer |
| `public/manifest.json` | PWA manifest (fullscreen, portrait) |
| `public/sw.js` | Service worker (cache-first assets) |
| `public/woofer.png` | Speaker cone image |
| `public/sf-logo.jpeg` | App icon |

---

## Layout

```
┌────────────────────────────────┐
│  HEADER (logo + cam button)    │  position:absolute, z:30
├────────────────────────────────┤
│                                │
│  HERO STAGE  (top 36%)         │  24/7 show content — TBD
│  particle field behind         │
│                                │
│  ┌──┬──┬──┬──┐                 │
│  │  │  │  │  │  4×4 SPEAKER   │  bottom 64%, grid
│  │  │  │  │  │  GRID          │
│  │  │  │  │  │                │
│  │  │  │  │  │                │
│  └──┴──┴──┴──┘                 │
│                                │
├────────────────────────────────┤
│  BUTTON STRIP (Play/Skit/etc)  │
│  SHADY INPUT BAR               │
└────────────────────────────────┘
```

---

## The Character — SHADY

- Based on Xander C. Gaines (House of Aviance, NYC door legend)
- Drag queen persona — sharp reads, ballroom vernacular, Spanglish, dry humor
- Chat endpoint: `POST http://192.168.1.167:8099/shady`
- Voice TTS: `POST http://192.168.1.167:8099/synthesize` → audio blob
- Mac Pro at `192.168.1.167` must be running the voice server (port 8099)

---

## Audio

- WebSocket `ws://localhost:8080` → 16-band meter data (with sim fallback)
- `tapGenre(slug)` sets visual state only — **music streaming not yet wired**
- Needs Pegasus backend URL to stream actual audio

---

## Hero Stage vision

The top 36% is a **24/7 live flatscreen show** — Shady as MC, Claude as the show-runner.
Currently a placeholder div. Build: Claude API (Haiku) on Mac Pro → drives Shady's lines, 
updates content, runs the show autonomously all night.

---

## Still to build

- [ ] Wire `tapGenre()` to actual audio streaming (Pegasus backend)
- [ ] Hero stage show content — Claude agent on Mac Pro
- [ ] Radio / Club / Vocal / Skit mode functionality
- [ ] Pro button
- [ ] CarPlay integration

---

## Rules

- Dark aesthetic — no polish, no cheese, underground NYC energy
- Shady is a real person in the UI — never break character
- Do NOT add max-width constraints — speakers must feel organic and full-bleed
- Do NOT simplify or stub real code
