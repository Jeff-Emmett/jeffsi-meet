"""
Configuration settings for the Meeting Intelligence API.
"""

from typing import List
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database
    postgres_url: str = "postgresql://meeting_intelligence:changeme@localhost:5432/meeting_intelligence"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Ollama (for AI summaries)
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"
    ollama_timeout: int = 600  # seconds (up from hardcoded 120)

    # AI Orchestrator (optional GPU fallback via RunPod)
    ai_orchestrator_url: str = ""  # empty = disabled, e.g. "http://ai-orchestrator:8080"
    ai_orchestrator_priority: str = "normal"  # low|normal|high

    # File paths
    recordings_path: str = "/recordings"

    # Security
    secret_key: str = "changeme"
    api_key: str = ""  # Optional API key authentication

    # CORS
    cors_origins: List[str] = [
        "https://meet.jeffemmett.com",
        "http://localhost:8080",
        "http://localhost:3000"
    ]

    # Embeddings model for semantic search
    embedding_model: str = "all-MiniLM-L6-v2"

    # Export settings
    export_temp_dir: str = "/tmp/exports"

    # Transcriber service URL
    transcriber_url: str = "http://transcriber:8001"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
