"""
AI Summary routes.
"""

import asyncio
import json
from typing import Optional, List

import httpx
from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from pydantic import BaseModel

from ..auth import validate_meeting_access
from ..config import settings

import structlog

log = structlog.get_logger()

router = APIRouter()


class ActionItem(BaseModel):
    task: str
    assignee: Optional[str] = None
    due_date: Optional[str] = None
    completed: bool = False


class Topic(BaseModel):
    topic: str
    duration_seconds: Optional[float] = None
    relevance_score: Optional[float] = None


class SummaryResponse(BaseModel):
    meeting_id: str
    summary_text: str
    key_points: List[str]
    action_items: List[ActionItem]
    decisions: List[str]
    topics: List[Topic]
    sentiment: Optional[str]
    model_used: str
    generated_at: str


class GenerateSummaryRequest(BaseModel):
    force_regenerate: bool = False


# Summarization prompt template
SUMMARY_PROMPT = """You are analyzing a meeting transcript. Your task is to extract key information and provide a structured summary.

## Meeting Transcript:
{transcript}

## Instructions:
Analyze the transcript and extract the following information. Be concise and accurate.

Respond ONLY with a valid JSON object in this exact format (no markdown, no extra text):
{{
    "summary": "A 2-3 sentence overview of what was discussed in the meeting",
    "key_points": ["Point 1", "Point 2", "Point 3"],
    "action_items": [
        {{"task": "Description of task", "assignee": "Person name or null", "due_date": "Date or null"}}
    ],
    "decisions": ["Decision 1", "Decision 2"],
    "topics": [
        {{"topic": "Topic name", "relevance_score": 0.9}}
    ],
    "sentiment": "positive" or "neutral" or "negative" or "mixed"
}}

Remember:
- key_points: 3-5 most important points discussed
- action_items: Tasks that need to be done, with assignees if mentioned
- decisions: Any decisions or conclusions reached
- topics: Main themes discussed with relevance scores (0-1)
- sentiment: Overall tone of the meeting
"""


def _load_jsonb(value, default=None):
    """Load a jsonb field that asyncpg may return as a string."""
    if default is None:
        default = []
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return value


def _summary_to_response(meeting_id: str, summary: dict) -> SummaryResponse:
    """Convert a DB summary row to a SummaryResponse."""
    key_points = _load_jsonb(summary["key_points"])
    action_items = _load_jsonb(summary["action_items"])
    decisions = _load_jsonb(summary["decisions"])
    topics = _load_jsonb(summary["topics"])

    return SummaryResponse(
        meeting_id=meeting_id,
        summary_text=summary["summary_text"],
        key_points=key_points,
        action_items=[ActionItem(**item) for item in action_items],
        decisions=decisions,
        topics=[Topic(**topic) for topic in topics],
        sentiment=summary.get("sentiment"),
        model_used=summary["model_used"],
        generated_at=summary["generated_at"].isoformat()
    )


@router.get("/{meeting_id}/summary", response_model=SummaryResponse)
async def get_summary(request: Request, meeting_id: str):
    """Get AI-generated summary for a meeting. Requires Bearer token."""
    await validate_meeting_access(request, meeting_id)

    db = request.app.state.db

    # Verify meeting exists
    meeting = await db.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    summary = await db.get_summary(meeting_id)

    if not summary:
        raise HTTPException(
            status_code=404,
            detail="No summary available. Use POST to generate one."
        )

    return _summary_to_response(meeting_id, summary)


@router.post("/{meeting_id}/summary", response_model=SummaryResponse)
async def generate_summary(
    request: Request,
    meeting_id: str,
    body: GenerateSummaryRequest,
    background_tasks: BackgroundTasks
):
    """Generate AI summary for a meeting. Requires Bearer token."""
    await validate_meeting_access(request, meeting_id)

    db = request.app.state.db

    # Verify meeting exists
    meeting = await db.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Check if summary already exists
    if not body.force_regenerate:
        existing = await db.get_summary(meeting_id)
        if existing:
            raise HTTPException(
                status_code=409,
                detail="Summary already exists. Set force_regenerate=true to regenerate."
            )

    # Get transcript
    segments = await db.get_transcript(meeting_id)
    if not segments:
        raise HTTPException(
            status_code=400,
            detail="No transcript available for summarization"
        )

    # Format transcript for LLM
    transcript_text = _format_transcript(segments)

    # Generate summary — try orchestrator first if configured, fall back to direct Ollama
    summary_data, model_used = await _generate_summary(transcript_text)

    # Save summary (serialize lists to JSON for asyncpg jsonb columns)
    await db.save_summary(
        meeting_id=meeting_id,
        summary_text=summary_data["summary"],
        key_points=json.dumps(summary_data["key_points"]),
        action_items=json.dumps(summary_data["action_items"]),
        decisions=json.dumps(summary_data["decisions"]),
        topics=json.dumps(summary_data["topics"]),
        sentiment=summary_data["sentiment"],
        model_used=model_used
    )

    # Update meeting status
    await db.update_meeting(meeting_id, status="ready")

    # Get the saved summary
    summary = await db.get_summary(meeting_id)

    return _summary_to_response(meeting_id, summary)


def _format_transcript(segments: list) -> str:
    """Format transcript segments for LLM processing."""
    lines = []
    current_speaker = None

    for s in segments:
        speaker = s.get("speaker_label") or "Speaker"

        if speaker != current_speaker:
            lines.append(f"\n[{speaker}]")
            current_speaker = speaker

        lines.append(s["text"])

    return "\n".join(lines)


async def _generate_summary(transcript: str) -> tuple[dict, str]:
    """Generate summary via orchestrator (if configured) with Ollama fallback.

    Returns (summary_data, model_used) tuple.
    """
    prompt = SUMMARY_PROMPT.format(transcript=transcript[:15000])  # Limit context

    # Try AI Orchestrator first if configured
    if settings.ai_orchestrator_url:
        try:
            result = await _generate_summary_with_orchestrator(prompt)
            return result, f"orchestrator/{result.get('_provider', 'unknown')}"
        except Exception as e:
            log.warning("Orchestrator failed, falling back to direct Ollama", error=str(e))

    # Fallback: direct Ollama with configurable timeout
    return await _generate_summary_with_ollama(prompt), settings.ollama_model


async def _generate_summary_with_orchestrator(prompt: str) -> dict:
    """Generate summary via AI Orchestrator (supports RunPod GPU fallback)."""
    timeout = settings.ollama_timeout

    async with httpx.AsyncClient(timeout=float(timeout)) as client:
        # Submit generation request
        response = await client.post(
            f"{settings.ai_orchestrator_url}/api/generate/text",
            json={
                "prompt": prompt,
                "system": "You are a meeting analysis assistant. Respond only with valid JSON.",
                "model": settings.ollama_model,
                "max_tokens": 2048,
                "temperature": 0.3,
                "priority": settings.ai_orchestrator_priority,
            }
        )
        response.raise_for_status()
        result = response.json()
        provider = result.get("provider", "unknown")

        log.info("Orchestrator responded", provider=provider, cost=result.get("cost"))

        if provider == "runpod":
            # Async RunPod job — poll for completion
            job_id = result["job_id"]
            response_text = await _poll_runpod_job(client, job_id, timeout)
        else:
            # Ollama sync response — text is already in the response
            response_text = result.get("response", "")

        summary_data = _parse_summary_json(response_text)
        summary_data["_provider"] = provider
        return summary_data


async def _poll_runpod_job(client: httpx.AsyncClient, job_id: str, max_wait: int) -> str:
    """Poll AI Orchestrator for RunPod job completion."""
    poll_url = f"{settings.ai_orchestrator_url}/api/status/llm/{job_id}"
    elapsed = 0
    interval = 5

    while elapsed < max_wait:
        await asyncio.sleep(interval)
        elapsed += interval

        resp = await client.get(poll_url)
        resp.raise_for_status()
        status_data = resp.json()
        status = status_data.get("status", "")

        log.debug("RunPod job poll", job_id=job_id, status=status, elapsed=elapsed)

        if status == "COMPLETED":
            output = status_data.get("output", {})
            return _extract_vllm_text(output)
        elif status == "FAILED":
            error = status_data.get("error", "Unknown RunPod error")
            raise RuntimeError(f"RunPod job failed: {error}")

    raise TimeoutError(f"RunPod job {job_id} did not complete within {max_wait}s")


def _extract_vllm_text(output) -> str:
    """Extract text from RunPod vLLM output which can be in various formats.

    Known formats:
    - list: [{"choices": [{"tokens": ["text..."]}], "usage": {...}}]
    - dict with "text": {"text": "..."}
    - dict with "response": {"response": "..."}
    - plain string
    """
    if isinstance(output, str):
        return output

    # vLLM list format: [{"choices": [{"tokens": ["chunk1", "chunk2"]}]}]
    if isinstance(output, list) and len(output) > 0:
        first = output[0]
        if isinstance(first, dict):
            choices = first.get("choices", [])
            if choices:
                tokens = choices[0].get("tokens", [])
                if tokens:
                    return "".join(str(t) for t in tokens)
        # Fallback: join all list items as strings
        return "".join(str(item) for item in output)

    if isinstance(output, dict):
        return output.get("text", output.get("response", json.dumps(output)))

    return str(output)


def _parse_summary_json(response_text: str) -> dict:
    """Parse and validate summary JSON from LLM response.

    Handles common LLM quirks: preamble text before JSON, trailing text after JSON.
    """
    # Strip any text before the first { and after the last }
    start = response_text.find("{")
    end = response_text.rfind("}")
    if start != -1 and end != -1 and end > start:
        response_text = response_text[start:end + 1]

    try:
        summary_data = json.loads(response_text)
    except json.JSONDecodeError as e:
        log.error("Failed to parse AI response as JSON", error=str(e), text=response_text[:500])
        raise HTTPException(status_code=500, detail="Failed to parse AI response")

    return {
        "summary": summary_data.get("summary", "No summary generated"),
        "key_points": summary_data.get("key_points", []),
        "action_items": summary_data.get("action_items", []),
        "decisions": summary_data.get("decisions", []),
        "topics": summary_data.get("topics", []),
        "sentiment": summary_data.get("sentiment", "neutral"),
    }


async def _generate_summary_with_ollama(prompt: str) -> dict:
    """Generate summary using direct Ollama with configurable timeout."""
    async with httpx.AsyncClient(timeout=float(settings.ollama_timeout)) as client:
        try:
            response = await client.post(
                f"{settings.ollama_url}/api/generate",
                json={
                    "model": settings.ollama_model,
                    "prompt": prompt,
                    "stream": False,
                    "format": "json"
                }
            )
            response.raise_for_status()

            result = response.json()
            response_text = result.get("response", "")

            return _parse_summary_json(response_text)

        except httpx.HTTPError as e:
            log.error("Ollama request failed", error=str(e))
            raise HTTPException(
                status_code=503,
                detail=f"AI service unavailable: {str(e)}"
            )
