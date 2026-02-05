"""
Whisper.cpp transcription wrapper.

Uses the whisper CLI to transcribe audio files.
"""

import json
import os
import subprocess
import tempfile
from dataclasses import dataclass
from typing import List, Optional

import structlog

log = structlog.get_logger()


@dataclass
class TranscriptSegment:
    """A single transcript segment."""
    start: float
    end: float
    text: str
    confidence: Optional[float] = None


@dataclass
class TranscriptionResult:
    """Result of a transcription job."""
    segments: List[TranscriptSegment]
    language: str
    duration: float
    text: str


class WhisperTranscriber:
    """Wrapper for whisper.cpp transcription."""

    def __init__(
        self,
        model_path: str = "/models/ggml-small.bin",
        threads: int = 8,
        language: str = "en"
    ):
        self.model_path = model_path
        self.threads = threads
        self.language = language
        self.whisper_bin = "/usr/local/bin/whisper"

        # Verify whisper binary exists
        if not os.path.exists(self.whisper_bin):
            raise RuntimeError(f"Whisper binary not found at {self.whisper_bin}")

        # Verify model exists
        if not os.path.exists(model_path):
            raise RuntimeError(f"Whisper model not found at {model_path}")

        log.info(
            "WhisperTranscriber initialized",
            model=model_path,
            threads=threads,
            language=language
        )

    def transcribe(
        self,
        audio_path: str,
        language: Optional[str] = None,
        translate: bool = False
    ) -> TranscriptionResult:
        """
        Transcribe an audio file.

        Args:
            audio_path: Path to the audio file (WAV format, 16kHz mono)
            language: Language code (e.g., 'en', 'es', 'fr') or None for auto-detect
            translate: If True, translate to English

        Returns:
            TranscriptionResult with segments and full text
        """
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        log.info("Starting transcription", audio_path=audio_path, language=language)

        # Create temp file for JSON output
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
            output_json = tmp.name

        try:
            # Build whisper command
            cmd = [
                self.whisper_bin,
                "-m", self.model_path,
                "-f", audio_path,
                "-t", str(self.threads),
                "-oj",  # Output JSON
                "-of", output_json.replace(".json", ""),  # Output file prefix
                "--print-progress",
            ]

            # Add language if specified
            if language:
                cmd.extend(["-l", language])
            else:
                cmd.extend(["-l", self.language])

            # Add translate flag if needed
            if translate:
                cmd.append("--translate")

            log.debug("Running whisper command", cmd=" ".join(cmd))

            # Run whisper
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=7200  # 2 hour timeout
            )

            if result.returncode != 0:
                log.error(
                    "Whisper transcription failed",
                    returncode=result.returncode,
                    stderr=result.stderr
                )
                raise RuntimeError(f"Whisper failed: {result.stderr}")

            # Parse JSON output
            with open(output_json, "r") as f:
                whisper_output = json.load(f)

            # Extract segments
            segments = []
            full_text_parts = []

            for item in whisper_output.get("transcription", []):
                segment = TranscriptSegment(
                    start=item["offsets"]["from"] / 1000.0,  # Convert ms to seconds
                    end=item["offsets"]["to"] / 1000.0,
                    text=item["text"].strip(),
                    confidence=item.get("confidence")
                )
                segments.append(segment)
                full_text_parts.append(segment.text)

            # Get detected language
            detected_language = whisper_output.get("result", {}).get("language", language or self.language)

            # Calculate total duration
            duration = segments[-1].end if segments else 0.0

            log.info(
                "Transcription complete",
                segments=len(segments),
                duration=duration,
                language=detected_language
            )

            return TranscriptionResult(
                segments=segments,
                language=detected_language,
                duration=duration,
                text=" ".join(full_text_parts)
            )

        finally:
            # Clean up temp files
            for ext in [".json", ".txt", ".vtt", ".srt"]:
                tmp_file = output_json.replace(".json", ext)
                if os.path.exists(tmp_file):
                    os.remove(tmp_file)

    def transcribe_with_timestamps(
        self,
        audio_path: str,
        language: Optional[str] = None
    ) -> List[dict]:
        """
        Transcribe with word-level timestamps.

        Returns list of dicts with word, start, end, confidence.
        """
        result = self.transcribe(audio_path, language)

        # Convert segments to word-level format
        # Note: whisper.cpp provides segment-level timestamps by default
        # For true word-level, we'd need the --max-len 1 flag but it's slower

        words = []
        for segment in result.segments:
            # Estimate word timestamps within segment
            segment_words = segment.text.split()
            if not segment_words:
                continue

            duration = segment.end - segment.start
            word_duration = duration / len(segment_words)

            for i, word in enumerate(segment_words):
                words.append({
                    "word": word,
                    "start": segment.start + (i * word_duration),
                    "end": segment.start + ((i + 1) * word_duration),
                    "confidence": segment.confidence
                })

        return words
