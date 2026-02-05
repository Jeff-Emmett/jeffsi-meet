"""
Configuration settings for the Transcription Service.
"""

import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Redis configuration
    redis_url: str = "redis://localhost:6379"

    # PostgreSQL configuration
    postgres_url: str = "postgresql://meeting_intelligence:changeme@localhost:5432/meeting_intelligence"

    # Whisper configuration
    whisper_model: str = "/models/ggml-small.bin"
    whisper_threads: int = 8
    whisper_language: str = "en"

    # Worker configuration
    num_workers: int = 4
    job_timeout: int = 7200  # 2 hours in seconds

    # Audio processing
    audio_sample_rate: int = 16000
    audio_channels: int = 1

    # Diarization settings
    min_speaker_duration: float = 0.5  # Minimum speaker segment in seconds
    max_speakers: int = 10

    # Paths
    recordings_path: str = "/recordings"
    audio_output_path: str = "/audio"
    temp_path: str = "/tmp/transcriber"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
