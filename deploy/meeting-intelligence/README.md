# Meeting Intelligence System

A fully self-hosted, zero-cost meeting intelligence system for Jeffsi Meet that provides:
- Automatic meeting recording via Jibri
- Local transcription via whisper.cpp (CPU-only)
- Speaker diarization (who said what)
- AI-powered summaries via Ollama
- Searchable meeting archive with dashboard

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Netcup RS 8000 (Backend)                       │
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │   Jibri     │───▶│  Whisper    │───▶│      AI Processor       │ │
│  │  Recording  │    │ Transcriber │    │  (Ollama + Summarizer)  │ │
│  │  Container  │    │  Service    │    │                         │ │
│  └─────────────┘    └─────────────┘    └─────────────────────────┘ │
│         │                  │                        │               │
│         ▼                  ▼                        ▼               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      PostgreSQL + pgvector                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

| Service | Port | Description |
|---------|------|-------------|
| PostgreSQL | 5432 | Database with pgvector for semantic search |
| Redis | 6379 | Job queue for async processing |
| Transcriber | 8001 | whisper.cpp + speaker diarization |
| API | 8000 | REST API for meetings, transcripts, search |
| Jibri | - | Recording service (joins meetings as hidden participant) |

## Deployment

### Prerequisites

1. Docker and Docker Compose installed
2. Ollama running on the host (for AI summaries)
3. Jeffsi Meet configured with recording enabled

### Setup

1. Copy environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your configuration:
   ```bash
   vim .env
   ```

3. Create storage directories:
   ```bash
   sudo mkdir -p /opt/meetings/{recordings,audio}
   sudo chown -R 1000:1000 /opt/meetings
   ```

4. Start services:
   ```bash
   docker compose up -d
   ```

5. Check logs:
   ```bash
   docker compose logs -f
   ```

## API Endpoints

Base URL: `https://meet.jeffemmett.com/api/intelligence`

### Meetings
- `GET /meetings` - List all meetings
- `GET /meetings/{id}` - Get meeting details
- `DELETE /meetings/{id}` - Delete meeting

### Transcripts
- `GET /meetings/{id}/transcript` - Get full transcript
- `GET /meetings/{id}/transcript/text` - Get as plain text
- `GET /meetings/{id}/speakers` - Get speaker statistics

### Summaries
- `GET /meetings/{id}/summary` - Get AI summary
- `POST /meetings/{id}/summary` - Generate summary

### Search
- `POST /search` - Search transcripts (text + semantic)
- `GET /search/suggest` - Get search suggestions

### Export
- `GET /meetings/{id}/export?format=markdown` - Export as Markdown
- `GET /meetings/{id}/export?format=json` - Export as JSON
- `GET /meetings/{id}/export?format=pdf` - Export as PDF

### Webhooks
- `POST /webhooks/recording-complete` - Jibri recording callback

## Processing Pipeline

1. **Recording** - Jibri joins meeting and records
2. **Webhook** - Jibri calls `/webhooks/recording-complete`
3. **Audio Extraction** - FFmpeg extracts audio from video
4. **Transcription** - whisper.cpp transcribes audio
5. **Diarization** - resemblyzer identifies speakers
6. **Embedding** - Generate vector embeddings for search
7. **Summary** - Ollama generates AI summary
8. **Ready** - Meeting available in dashboard

## Resource Usage

| Service | CPU | RAM | Storage |
|---------|-----|-----|---------|
| Transcriber | 8 cores | 12GB | 5GB (models) |
| API | 1 core | 2GB | - |
| PostgreSQL | 2 cores | 4GB | ~50GB |
| Jibri | 2 cores | 4GB | - |
| Redis | 0.5 cores | 512MB | - |

## Troubleshooting

### Transcription is slow
- Check CPU usage: `docker stats meeting-intelligence-transcriber`
- Increase `WHISPER_THREADS` in docker-compose.yml
- Consider using the `tiny` model for faster (less accurate) transcription

### No summary generated
- Check Ollama is running: `curl http://localhost:11434/api/tags`
- Check logs: `docker compose logs api`
- Verify model is available: `ollama list`

### Recording not starting
- Check Jibri logs: `docker compose logs jibri`
- Verify XMPP credentials in `.env`
- Check Prosody recorder virtual host configuration

## Cost Analysis

| Component | Monthly Cost |
|-----------|-------------|
| Jibri recording | $0 (local) |
| Whisper transcription | $0 (local CPU) |
| Ollama summarization | $0 (local) |
| PostgreSQL | $0 (local) |
| **Total** | **$0/month** |
