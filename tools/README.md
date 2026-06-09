# ShadyRadio Tools

Music analysis and preparation tools for ShadyRadio.

## analyze.py

CLI tool for analyzing music files (BPM, key, energy) and preparing them for upload to R2.

### Installation

```bash
cd tools
pip install -r requirements.txt
```

Requires ffmpeg (librosa dependency):
- macOS: `brew install ffmpeg`
- Ubuntu: `sudo apt-get install ffmpeg`

### Usage

Analyze a folder and organize by genre:

```bash
python analyze.py ~/Music/DJSets --out ~/shadyradio/output --genre house
```

This will:
1. Scan for audio files (.mp3, .flac, .m4a, .aac, .ogg, .wav)
2. Detect BPM using librosa beat tracking
3. Detect key using Krumhansl-Schmuckler algorithm → convert to Camelot notation
4. Calculate RMS energy
5. Copy files to `output/house/` folder
6. Generate `manifest.json` with all metadata
7. Create `upload.sh` script for R2 upload

### Options

```
python analyze.py --help

  input                 Input music folder
  --out, -o             Output folder for organized tracks (required)
  --genre, -g           Genre name: house, techno, deep-house, etc. (required)
  --workers, -w         Number of parallel workers (default: 4)
  --skip-analysis       Skip analysis, just organize by filename
```

### Multiple Genres

Analyze each genre separately:

```bash
# House tracks
python analyze.py ~/Music/House --out ~/shadyradio/output --genre house

# Techno tracks
python analyze.py ~/Music/Techno --out ~/shadyradio/output --genre techno

# The manifest.json accumulates all genres
```

### Upload to R2

After analysis, upload to Cloudflare R2:

```bash
cd ~/shadyradio/output
bash upload.sh

# Or manually:
npx wrangler r2 object put shadyradio-audio/manifest.json --file manifest.json
npx wrangler r2 object put shadyradio-audio/house/track1.mp3 --file house/track1.mp3
```

### Manifest Format

The generated `manifest.json`:

```json
{
  "genres": {
    "house": [
      {
        "file": "house/track1.mp3",
        "title": "Summer Vibes",
        "artist": "DJ Example",
        "bpm": 124.5,
        "key": "8A",
        "energy": 0.245
      }
    ]
  }
}
```

This is read by the Cloudflare Worker to serve metadata alongside audio URLs.

### BPM/Key Detection Accuracy

- **BPM**: librosa's tempo estimation is generally accurate within ±1 BPM for electronic music with clear beats
- **Key**: Krumhansl-Schmuckler correlates chroma features against key profiles. Accuracy varies by genre:
  - House/Techno: ~80-90% accuracy
  - Jazz/Classical: Lower accuracy (complex harmony)
  - Ambient/Noise: May fail (returns null)

Always spot-check results and manually correct in `manifest.json` if needed.
