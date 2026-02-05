"""
AI Summary routes.
"""

import json
from typing import Optional, List

import httpx
from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from pydantic import BaseModel

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


@router.get("/{meeting_id}/summary", response_model=SummaryResponse)
async def get_summary(request: Request, meeting_id: str):
    """Get AI-generated summary for a meeting."""
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

    return SummaryResponse(
        meeting_id=meeting_id,
        summary_text=summary["summary_text"],
        key_points=summary["key_points"] or [],
        action_items=[
            ActionItem(**item) for item in (summary["action_items"] or [])
        ],
        decisions=summary["decisions"] or [],
        topics=[
            Topic(**topic) for topic in (summary["topics"] or [])
        ],
        sentiment=summary.get("sentiment"),
        model_used=summary["model_used"],
        generated_at=summary["generated_at"].isoformat()
    )


@router.post("/{meeting_id}/summary", response_model=SummaryResponse)
async def generate_summary(
    request: Request,
    meeting_id: str,
    body: GenerateSummaryRequest,
    background_tasks: BackgroundTasks
):
    """Generate AI summary for a meeting."""
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

    # Generate summary using Ollama
    summary_data = await _generate_summary_with_ollama(transcript_text)

    # Save summary
    await db.save_summary(
        meeting_id=meeting_id,
        summary_text=summary_data["summary"],
        key_points=summary_data["key_points"],
        action_items=summary_data["action_items"],
        decisions=summary_data["decisions"],
        topics=summary_data["topics"],
        sentiment=summary_data["sentiment"],
        model_used=settings.ollama_model
    )

    # Update meeting status
    await db.update_meeting(meeting_id, status="ready")

    # Get the saved summary
    summary = await db.get_summary(meeting_id)

    return SummaryResponse(
        meeting_id=meeting_id,
        summary_text=summary["summary_text"],
        key_points=summary["key_points"] or [],
        action_items=[
            ActionItem(**item) for item in (summary["action_items"] or [])
        ],
        decisions=summary["decisions"] or [],
        topics=[
            Topic(**topic) for topic in (summary["topics"] or [])
        ],
        sentiment=summary.get("sentiment"),
        model_used=summary["model_used"],
        generated_at=summary["generated_at"].isoformat()
    )


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


async def _generate_summary_with_ollama(transcript: str) -> dict:
    """Generate summary using Ollama."""
    prompt = SUMMARY_PROMPT.format(transcript=transcript[:15000])  # Limit context

    async with httpx.AsyncClient(timeout=120.0) as client:
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

            # Parse JSON from response
            summary_data = json.loads(response_text)

            # Validate required fields
            return {
                "summary": summary_data.get("summary", "No summary generated"),
                "key_points": summary_data.get("key_points", []),
                "action_items": summary_data.get("action_items", []),
                "decisions": summary_data.get("decisions", []),
                "topics": summary_data.get("topics", []),
                "sentiment": summary_data.get("sentiment", "neutral")
            }

        except httpx.HTTPError as e:
            log.error("Ollama request failed", error=str(e))
            raise HTTPException(
                status_code=503,
                detail=f"AI service unavailable: {str(e)}"
            )
        except json.JSONDecodeError as e:
            log.error("Failed to parse Ollama response", error=str(e))
            raise HTTPException(
                status_code=500,
                detail="Failed to parse AI response"
            )
