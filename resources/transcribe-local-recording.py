#!/usr/bin/env python3
"""
Re-transcribe a jeffsi local recording from its per-speaker audio stems.

A local recording folder holds one audio file per participant (stems/) and a
manifest.json with each stem's offset into the meeting. Because every stem is
one person, speaker attribution is exact - no acoustic diarization guesswork,
and cross-talk does not smear two speakers together. This script:

  1. finds speech in each stem (ffmpeg silencedetect),
  2. sends each utterance to an OpenAI-compatible /v1/audio/transcriptions
     endpoint (default: GX10 Parakeet over the tailnet),
  3. merges all speakers by time into transcript.accurate.{md,vtt,json}.

The live transcript written during the call is left untouched.

Usage:
  resources/transcribe-local-recording.py <recording-folder>
      [--asr-url URL] [--model NAME] [--language en] [--api-key-env VAR]

Needs ffmpeg on PATH. No Python dependencies beyond the standard library.
"""
import argparse
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
import uuid

MAX_UTTERANCE_S = 25.0
MIN_UTTERANCE_S = 0.4
MERGE_GAP_S = 0.5
PAD_S = 0.15


def media_duration(path):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
        capture_output=True, text=True, check=True).stdout.strip()
    try:
        return float(out)
    except ValueError:
        # Some MediaRecorder files carry no duration; decode to find it.
        log = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-f', 'null', '-'],
                             capture_output=True, text=True).stderr
        times = re.findall(r'time=(\d+):(\d+):([\d.]+)', log)
        h, m, s = times[-1] if times else (0, 0, 0)
        return int(h) * 3600 + int(m) * 60 + float(s)


def speech_regions(path, noise_db):
    """Returns [(start, end)] of non-silent audio, merged and length-capped."""
    duration = media_duration(path)
    log = subprocess.run(
        ['ffmpeg', '-hide_banner', '-i', path, '-af', f'silencedetect=noise={noise_db}dB:d=0.6', '-f', 'null', '-'],
        capture_output=True, text=True).stderr
    silences = []
    start = None
    for line in log.splitlines():
        m = re.search(r'silence_start: (-?[\d.]+)', line)
        if m:
            start = max(0.0, float(m.group(1)))
        m = re.search(r'silence_end: ([\d.]+)', line)
        if m and start is not None:
            silences.append((start, float(m.group(1))))
            start = None
    if start is not None:
        silences.append((start, duration))

    regions = []
    cursor = 0.0
    for s, e in silences:
        if s > cursor:
            regions.append((cursor, s))
        cursor = e
    if cursor < duration:
        regions.append((cursor, duration))

    merged = []
    for s, e in regions:
        if merged and s - merged[-1][1] < MERGE_GAP_S and e - merged[-1][0] <= MAX_UTTERANCE_S:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))

    out = []
    for s, e in merged:
        while e - s > MAX_UTTERANCE_S:
            out.append((s, s + MAX_UTTERANCE_S))
            s += MAX_UTTERANCE_S
        if e - s >= MIN_UTTERANCE_S:
            out.append((s, e))
    return out


def transcribe(wav_path, url, model, language, api_key):
    boundary = uuid.uuid4().hex
    with open(wav_path, 'rb') as f:
        audio = f.read()
    parts = []
    for name, value in (('model', model), ('language', language), ('response_format', 'json')):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\n'
                 f'Content-Type: audio/wav\r\n\r\n'.encode() + audio + b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    req = urllib.request.Request(url, data=b''.join(parts), method='POST',
                                 headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    if api_key:
        req.add_header('Authorization', f'Bearer {api_key}')
    with urllib.request.urlopen(req, timeout=120) as r:
        body = r.read().decode()
    try:
        return (json.loads(body).get('text') or '').strip()
    except ValueError:
        return body.strip()


def vtt_time(t):
    ms = max(0, round(t * 1000))
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02}.{ms % 1000:03}'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folder')
    ap.add_argument('--asr-url', default=os.environ.get('ASR_URL', 'http://100.64.0.5:8990/v1/audio/transcriptions'))
    ap.add_argument('--model', default=os.environ.get('ASR_MODEL', 'parakeet'))
    ap.add_argument('--language', default='en')
    ap.add_argument('--api-key-env', help='name of an env var holding a bearer token for the ASR endpoint')
    ap.add_argument('--workers', type=int, default=6, help='parallel ASR requests (default 6)')
    ap.add_argument('--noise-db', type=float, default=-38.0, help='silence threshold (default -38 dB)')
    args = ap.parse_args()

    with open(os.path.join(args.folder, 'manifest.json')) as f:
        manifest = json.load(f)
    api_key = os.environ.get(args.api_key_env, '') if args.api_key_env else ''

    segments = []
    with tempfile.TemporaryDirectory() as tmp, \
            concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        stems = manifest['stems']
        paths = [os.path.join(args.folder, stem['file']) for stem in stems]
        all_regions = list(pool.map(lambda p: speech_regions(p, args.noise_db), paths))

        def utterance(job):
            n, stem, path, s, e = job
            offset = stem.get('offsetMs', 0) / 1000
            wav = os.path.join(tmp, f'{n}.wav')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{s:.3f}', '-t', f'{e - s:.3f}', '-i', path,
                            '-ac', '1', '-ar', '16000', wav], check=True)
            try:
                text = transcribe(wav, args.asr_url, args.model, args.language, api_key)
            except Exception as err:  # keep going; a gap is better than no transcript
                print(f'  {stem["name"]} {vtt_time(offset + s)} ASR failed: {err}', file=sys.stderr)
                return None
            finally:
                os.remove(wav)
            return text and {'start': round(offset + s, 3), 'end': round(offset + e, 3),
                             'speaker': stem['name'], 'speakerId': stem['participantId'], 'text': text}

        jobs = []
        for stem, path, regions in zip(stems, paths, all_regions):
            print(f"{stem['name']}: {len(regions)} utterances", file=sys.stderr)
            for s, e in regions:
                jobs.append((len(jobs), stem, path, max(0.0, s - PAD_S), e + PAD_S))
        segments = [x for x in pool.map(utterance, jobs) if x]

    segments.sort(key=lambda x: x['start'])

    with open(os.path.join(args.folder, 'transcript.accurate.json'), 'w') as f:
        json.dump({'startedAt': manifest.get('startedAt'), 'source': 'stems', 'asr': args.model,
                   'segments': segments}, f, indent=2)
    with open(os.path.join(args.folder, 'transcript.accurate.vtt'), 'w') as f:
        f.write('WEBVTT\n\n')
        for x in segments:
            f.write(f"{vtt_time(x['start'])} --> {vtt_time(x['end'])}\n<v {x['speaker']}>{x['text']}\n\n")
    with open(os.path.join(args.folder, 'transcript.accurate.md'), 'w') as f:
        f.write(f"# {manifest.get('room', 'Meeting')}\n\nRecorded {manifest.get('startedAt', '')}\n\n")
        prev = None
        for x in segments:
            if x['speaker'] != prev:
                f.write(f"\n**{x['speaker']}** [{vtt_time(x['start'])[:8]}]: ")
                prev = x['speaker']
            else:
                f.write(' ')
            f.write(x['text'])
        f.write('\n')
    print(f'{len(segments)} segments -> transcript.accurate.{{md,vtt,json}}', file=sys.stderr)


if __name__ == '__main__':
    main()
