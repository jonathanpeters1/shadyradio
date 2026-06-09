#!/usr/bin/env python3
"""
ShadyRadio Music Analysis Tool
Scans music folders, detects BPM/key/energy, organizes into genre subfolders,
generates manifest.json for R2 upload.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import colorama
import librosa
import numpy as np
from colorama import Fore, Style
from tqdm import tqdm

# Initialize colorama
colorama.init()

# Camelot wheel mapping (Krumhansl-Schmuckler key profiles → Camelot)
KEY_PROFILES = {
    'C major': ('8B', 0), 'C# major': ('3B', 1), 'D major': ('10B', 2),
    'D# major': ('5B', 3), 'E major': ('12B', 4), 'F major': ('7B', 5),
    'F# major': ('2B', 6), 'G major': ('9B', 7), 'G# major': ('4B', 8),
    'A major': ('11B', 9), 'A# major': ('6B', 10), 'B major': ('1B', 11),
    'C minor': ('5A', 12), 'C# minor': ('12A', 13), 'D minor': ('7A', 14),
    'D# minor': ('2A', 15), 'E minor': ('9A', 16), 'F minor': ('4A', 17),
    'F# minor': ('11A', 18), 'G minor': ('6A', 19), 'G# minor': ('1A', 20),
    'A minor': ('8A', 21), 'A# minor': ('3A', 22), 'B minor': ('10A', 23),
}


def detect_key(y, sr):
    """Detect musical key using Krumhansl-Schmuckler algorithm."""
    # Compute chromagram
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, bins_per_octave=36)

    # Krumhansl-Schmuckler key profiles (major and minor)
    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    # Normalize chroma by sum
    chroma_sum = np.sum(chroma, axis=1)
    if np.sum(chroma_sum) == 0:
        return None, None

    chroma_norm = chroma_sum / np.sum(chroma_sum)

    # Correlate with major and minor profiles for all 12 rotations
    best_score = -np.inf
    best_key = None

    for i in range(12):
        # Rotate chroma
        rotated = np.roll(chroma_norm, i)

        # Major correlation
        major_corr = np.corrcoef(rotated, major_profile)[0, 1]
        if major_corr > best_score:
            best_score = major_corr
            key_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
            best_key = f"{key_names[i]} major"

        # Minor correlation
        minor_corr = np.corrcoef(rotated, minor_profile)[0, 1]
        if minor_corr > best_score:
            best_score = minor_corr
            key_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
            best_key = f"{key_names[i]} minor"

    if best_key and best_key in KEY_PROFILES:
        camelot, encoded = KEY_PROFILES[best_key]
        return camelot, encoded

    return None, None


def analyze_file(filepath):
    """Analyze a single audio file for BPM, key, and energy."""
    try:
        # Load audio (resample to 22050 for faster processing)
        y, sr = librosa.load(filepath, sr=22050, duration=120)  # Analyze first 2 minutes max

        if len(y) < sr * 10:  # Need at least 10 seconds
            return None

        # Detect BPM
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        tempo = librosa.beat.tempo(onset_envelope=onset_env, sr=sr)
        bpm = float(tempo[0]) if len(tempo) > 0 else 0

        # Detect key
        camelot, camelot_encoded = detect_key(y, sr)

        # Calculate RMS energy
        rms = librosa.feature.rms(y=y)
        energy = float(np.mean(rms)) if rms is not None and len(rms[0]) > 0 else 0

        # Get metadata
        from mutagen.mp3 import MP3
        from mutagen.flac import FLAC
        from mutagen.m4a import M4A

        title = Path(filepath).stem
        artist = None

        try:
            if filepath.endswith('.mp3'):
                audio = MP3(filepath)
                if audio.tags:
                    title = audio.tags.get('TIT2', title)
                    artist = audio.tags.get('TPE1', None)
            elif filepath.endswith('.flac'):
                audio = FLAC(filepath)
                if audio.tags:
                    title = audio.tags.get('title', [title])[0]
                    artist = audio.tags.get('artist', [None])[0]
            elif filepath.endswith('.m4a'):
                audio = M4A(filepath)
                if audio.tags:
                    title = audio.tags.get('\xa9nam', [title])[0]
                    artist = audio.tags.get('\xa9ART', [None])[0]
        except Exception:
            pass

        return {
            'file': filepath,
            'bpm': round(bpm, 1) if bpm > 0 else None,
            'key': camelot,
            'camelot_encoded': camelot_encoded,
            'energy': round(energy * 1000, 2),  # Scale for readability
            'title': str(title) if title else Path(filepath).stem,
            'artist': str(artist) if artist else None,
        }

    except Exception as e:
        print(f"{Fore.RED}Error analyzing {filepath}: {e}{Style.RESET_ALL}")
        return None


def copy_to_genre_folder(result, src_base, output_base, genre):
    """Copy analyzed file to genre subfolder."""
    src_path = Path(result['file'])
    rel_path = src_path.relative_to(src_base)

    # Create genre subfolder
    genre_folder = Path(output_base) / genre
    genre_folder.mkdir(parents=True, exist_ok=True)

    # Copy file with relative path preserved
    dst_path = genre_folder / rel_path.name
    counter = 1
    while dst_path.exists():
        stem = src_path.stem
        suffix = src_path.suffix
        dst_path = genre_folder / f"{stem}_{counter}{suffix}"
        counter += 1

    shutil.copy2(src_path, dst_path)

    # Return relative path for manifest
    return f"{genre}/{dst_path.name}"


def main():
    parser = argparse.ArgumentParser(description='Analyze music for ShadyRadio')
    parser.add_argument('input', help='Input music folder')
    parser.add_argument('--out', '-o', required=True, help='Output folder for organized tracks')
    parser.add_argument('--genre', '-g', required=True, help='Genre name (e.g., house, techno)')
    parser.add_argument('--workers', '-w', type=int, default=4, help='Number of parallel workers')
    parser.add_argument('--skip-analysis', action='store_true', help='Skip analysis, just organize')

    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.out).expanduser().resolve()

    if not input_path.exists():
        print(f"{Fore.RED}Input path does not exist: {input_path}{Style.RESET_ALL}")
        sys.exit(1)

    # Find audio files
    audio_extensions = {'.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav'}
    audio_files = []

    for ext in audio_extensions:
        audio_files.extend(input_path.rglob(f'*{ext}'))

    if not audio_files:
        print(f"{Fore.RED}No audio files found in {input_path}{Style.RESET_ALL}")
        sys.exit(1)

    print(f"{Fore.CYAN}Found {len(audio_files)} audio files{Style.RESET_ALL}")
    print(f"{Fore.CYAN}Analyzing with {args.workers} workers...{Style.RESET_ALL}\n")

    # Analyze files in parallel
    results = []
    if args.skip_analysis:
        # Just use filenames as titles
        for f in audio_files:
            results.append({
                'file': str(f),
                'bpm': None,
                'key': None,
                'camelot_encoded': None,
                'energy': None,
                'title': f.stem,
                'artist': None,
            })
    else:
        with ProcessPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(analyze_file, str(f)): f for f in audio_files}

            for future in tqdm(as_completed(futures), total=len(futures), desc="Analyzing"):
                result = future.result()
                if result:
                    results.append(result)

    if not results:
        print(f"{Fore.RED}No files successfully analyzed{Style.RESET_ALL}")
        sys.exit(1)

    print(f"\n{Fore.GREEN}Successfully analyzed {len(results)} tracks{Style.RESET_ALL}")

    # Copy files to genre folders and build manifest
    manifest_tracks = []
    print(f"\n{Fore.CYAN}Copying to {args.genre} folder...{Style.RESET_ALL}")

    for result in tqdm(results, desc="Copying"):
        manifest_path = copy_to_genre_folder(result, input_path, output_path, args.genre)

        track_entry = {
            'file': manifest_path,
            'title': result['title'],
            'artist': result['artist'],
        }
        if result['bpm']:
            track_entry['bpm'] = result['bpm']
        if result['key']:
            track_entry['key'] = result['key']
        if result['energy']:
            track_entry['energy'] = result['energy']

        manifest_tracks.append(track_entry)

    # Load existing manifest or create new
    manifest_path = output_path / 'manifest.json'
    manifest = {'genres': {}}

    if manifest_path.exists():
        with open(manifest_path, 'r') as f:
            manifest = json.load(f)

    if 'genres' not in manifest:
        manifest['genres'] = {}

    manifest['genres'][args.genre] = manifest_tracks

    # Write manifest
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)

    print(f"\n{Fore.GREEN}✓ Manifest written to {manifest_path}{Style.RESET_ALL}")

    # Generate upload script
    upload_script = output_path / 'upload.sh'
    with open(upload_script, 'w') as f:
        f.write(f"#!/bin/bash\n")
        f.write(f"# Upload script for {args.genre}\n\n")
        f.write(f"cd \"{output_path}\"\n\n")
        f.write(f"# Upload manifest\n")
        f.write(f"npx wrangler r2 object put shadyradio-audio/manifest.json --file manifest.json\n\n")
        f.write(f"# Upload tracks\n")
        for track in manifest_tracks:
            f.write(f"npx wrangler r2 object put shadyradio-audio/{track['file']} --file {track['file']}\n")

    upload_script.chmod(0o755)
    print(f"{Fore.GREEN}✓ Upload script written to {upload_script}{Style.RESET_ALL}")

    # Print summary
    print(f"\n{Fore.CYAN}=== Summary ==={Style.RESET_ALL}")
    print(f"Genre: {args.genre}")
    print(f"Tracks: {len(manifest_tracks)}")

    if not args.skip_analysis:
        bpms = [t['bpm'] for t in manifest_tracks if 'bpm' in t]
        if bpms:
            print(f"Avg BPM: {sum(bpms)/len(bpms):.1f}")
            print(f"BPM range: {min(bpms):.1f} - {max(bpms):.1f}")

        keys = [t['key'] for t in manifest_tracks if 'key' in t]
        if keys:
            key_counts = {}
            for k in keys:
                key_counts[k] = key_counts.get(k, 0) + 1
            print(f"Top keys: {', '.join(f'{k}({v})' for k, v in sorted(key_counts.items(), key=lambda x: -x[1])[:3])}")

    print(f"\n{Fore.YELLOW}Next steps:{Style.RESET_ALL}")
    print(f"  1. Review tracks in {output_path}/{args.genre}/")
    print(f"  2. Run: {upload_script}")
    print(f"  3. Or manually: npx wrangler r2 object put shadyradio-audio/manifest.json --file manifest.json")


if __name__ == '__main__':
    main()
