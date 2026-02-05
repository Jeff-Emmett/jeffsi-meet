"""
Meeting Intelligence API

Provides REST API for:
- Meeting management
- Transcript retrieval
- AI-powered summaries
- Semantic search
- Export functionality
"""

import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Database
from .routes import meetings, transcripts, summaries, search, webhooks, export

import structlog

log = structlog.get_logger()


# Application state
class AppState:
    db: Optional[Database] = None


state = AppState()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown."""
    log.info("Starting Meeting Intelligence API...")

    # Initialize database
    state.db = Database(settings.postgres_url)
    await state.db.connect()

    # Make database available to routes
    app.state.db = state.db

    log.info("Meeting Intelligence API started successfully")

    yield

    # Shutdown
    log.info("Shutting down Meeting Intelligence API...")
    if state.db:
        await state.db.disconnect()

    log.info("Meeting Intelligence API stopped")


app = FastAPI(
    title="Meeting Intelligence API",
    description="API for meeting transcripts, summaries, and search",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(meetings.router, prefix="/meetings", tags=["Meetings"])
app.include_router(transcripts.router, prefix="/meetings", tags=["Transcripts"])
app.include_router(summaries.router, prefix="/meetings", tags=["Summaries"])
app.include_router(search.router, prefix="/search", tags=["Search"])
app.include_router(webhooks.router, prefix="/webhooks", tags=["Webhooks"])
app.include_router(export.router, prefix="/meetings", tags=["Export"])


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    db_ok = False

    try:
        if state.db:
            await state.db.health_check()
            db_ok = True
    except Exception as e:
        log.error("Database health check failed", error=str(e))

    return {
        "status": "healthy" if db_ok else "unhealthy",
        "database": db_ok,
        "version": "1.0.0"
    }


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "service": "Meeting Intelligence API",
        "version": "1.0.0",
        "docs": "/docs"
    }
