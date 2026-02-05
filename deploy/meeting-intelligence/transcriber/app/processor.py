"""
Job Processor for the Transcription Service.

Handles the processing pipeline:
1. Audio extraction from video
2. Transcription
3. Speaker diarization
4. Database storage
"""

import asyncio
import os
import subprocess
from typing import Optional

import structlog

from .config import settings
from .transcriber import WhisperTranscriber, TranscriptionResult
from .diarizer import SpeakerDiarizer, SpeakerSegment
from .database import Database

log = structlog.get_logger()


class JobProcessor:
    """Processes transcription jobs from the queue."""

    def __init__(
        self,
        transcriber: WhisperTranscriber,
        diarizer: SpeakerDiarizer,
        db: Database,
        redis
    ):
        self.transcriber = transcriber
        self.diarizer = diarizer
        self.db = db
        self.redis = redis
        self.active_jobs = 0
        self._running = False
        self._workers = []

    async def process_jobs(self):
        """Main job processing loop."""
        self._running = True
        log.info("Job processor started", num_workers=settings.num_workers)

        # Start worker tasks
        for i in range(settings.num_workers):
            worker = asyncio.create_task(self._worker(i))
            self._workers.append(worker)

        # Wait for all workers
        await asyncio.gather(*self._workers, return_exceptions=True)

    async def stop(self):
        """Stop the job processor."""
        self._running = False
        for worker in self._workers:
            worker.cancel()
        log.info("Job processor stopped")

    async def _worker(self, worker_id: int):
        """Worker that processes individual jobs."""
        log.info(f"Worker {worker_id} started")

        while self._running:
            try:
                # Get next job from database
                job = await self.db.get_next_pending_job()

                if job is None:
                    # No jobs, wait a bit
                    await asyncio.sleep(2)
                    continue

                job_id = job["id"]
                meeting_id = job["meeting_id"]

                log.info(
                    f"Worker {worker_id} processing job",
                    job_id=job_id,
                    meeting_id=meeting_id
                )

                self.active_jobs += 1

                try:
                    await self._process_job(job)
                except Exception as e:
                    log.error(
                        "Job processing failed",
                        job_id=job_id,
                        error=str(e)
                    )
                    await self.db.update_job_status(
                        job_id,
                        "failed",
                        error_message=str(e)
                    )
                finally:
                    self.active_jobs -= 1

            except asyncio.CancelledError:
                break
            except Exception as e:
                log.error(f"Worker {worker_id} error", error=str(e))
                await asyncio.sleep(5)

        log.info(f"Worker {worker_id} stopped")

    async def _process_job(self, job: dict):
        """Process a single transcription job."""
        job_id = job["id"]
        meeting_id = job["meeting_id"]
        audio_path = job.get("audio_path")
        video_path = job.get("video_path")
        enable_diarization = job.get("enable_diarization", True)
        language = job.get("language")

        # Update status to processing
        await self.db.update_job_status(job_id, "processing")
        await self.db.update_meeting_status(meeting_id, "transcribing")

        # Step 1: Extract audio if we have video
        if video_path and not audio_path:
            log.info("Extracting audio from video", video_path=video_path)
            await self.db.update_job_status(job_id, "processing", progress=0.1)

            audio_path = await self._extract_audio(video_path, meeting_id)
            await self.db.update_job_audio_path(job_id, audio_path)

        if not audio_path or not os.path.exists(audio_path):
            raise RuntimeError(f"Audio file not found: {audio_path}")

        # Step 2: Transcribe
        log.info("Starting transcription", audio_path=audio_path)
        await self.db.update_job_status(job_id, "processing", progress=0.3)

        transcription = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self.transcriber.transcribe(audio_path, language)
        )

        log.info(
            "Transcription complete",
            segments=len(transcription.segments),
            duration=transcription.duration
        )

        # Step 3: Speaker diarization
        speaker_segments = []
        if enable_diarization and len(transcription.segments) > 0:
            log.info("Starting speaker diarization")
            await self.db.update_job_status(job_id, "processing", progress=0.6)
            await self.db.update_meeting_status(meeting_id, "diarizing")

            # Convert transcript segments to dicts for diarizer
            transcript_dicts = [
                {"start": s.start, "end": s.end, "text": s.text}
                for s in transcription.segments
            ]

            speaker_segments = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.diarizer.diarize(
                    audio_path,
                    transcript_segments=transcript_dicts
                )
            )

            log.info(
                "Diarization complete",
                num_segments=len(speaker_segments),
                num_speakers=len(set(s.speaker_id for s in speaker_segments))
            )

        # Step 4: Store results
        log.info("Storing transcript in database")
        await self.db.update_job_status(job_id, "processing", progress=0.9)

        await self._store_transcript(
            meeting_id,
            transcription,
            speaker_segments
        )

        # Mark job complete
        await self.db.update_job_status(
            job_id,
            "completed",
            result={
                "segments": len(transcription.segments),
                "duration": transcription.duration,
                "language": transcription.language,
                "speakers": len(set(s.speaker_id for s in speaker_segments)) if speaker_segments else 0
            }
        )

        # Update meeting status - ready for summarization
        await self.db.update_meeting_status(meeting_id, "summarizing")

        log.info("Job completed successfully", job_id=job_id)

    async def _extract_audio(self, video_path: str, meeting_id: str) -> str:
        """Extract audio from video file using ffmpeg."""
        output_dir = os.path.join(settings.audio_output_path, meeting_id)
        os.makedirs(output_dir, exist_ok=True)

        audio_path = os.path.join(output_dir, "audio.wav")

        cmd = [
            "ffmpeg",
            "-i", video_path,
            "-vn",  # No video
            "-acodec", "pcm_s16le",  # PCM 16-bit
            "-ar", str(settings.audio_sample_rate),  # Sample rate
            "-ac", str(settings.audio_channels),  # Mono
            "-y",  # Overwrite
            audio_path
        ]

        log.debug("Running ffmpeg", cmd=" ".join(cmd))

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        _, stderr = await process.communicate()

        if process.returncode != 0:
            raise RuntimeError(f"FFmpeg failed: {stderr.decode()}")

        log.info("Audio extracted", output=audio_path)
        return audio_path

    async def _store_transcript(
        self,
        meeting_id: str,
        transcription: TranscriptionResult,
        speaker_segments: list
    ):
        """Store transcript segments in database."""
        # Create a map from time ranges to speakers
        speaker_map = {}
        for seg in speaker_segments:
            speaker_map[(seg.start, seg.end)] = (seg.speaker_id, seg.speaker_label)

        # Store each transcript segment
        for i, segment in enumerate(transcription.segments):
            # Find matching speaker
            speaker_id = None
            speaker_label = None

            for (start, end), (sid, slabel) in speaker_map.items():
                if segment.start >= start and segment.end <= end:
                    speaker_id = sid
                    speaker_label = slabel
                    break

            # If no exact match, find closest overlap
            if speaker_id is None:
                for seg in speaker_segments:
                    if segment.start < seg.end and segment.end > seg.start:
                        speaker_id = seg.speaker_id
                        speaker_label = seg.speaker_label
                        break

            await self.db.insert_transcript_segment(
                meeting_id=meeting_id,
                segment_index=i,
                start_time=segment.start,
                end_time=segment.end,
                text=segment.text,
                speaker_id=speaker_id,
                speaker_label=speaker_label,
                confidence=segment.confidence,
                language=transcription.language
            )
