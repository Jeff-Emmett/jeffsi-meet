"""
Export routes for Meeting Intelligence.

Supports exporting meetings as PDF, Markdown, and JSON.
"""

import io
import json
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import structlog

log = structlog.get_logger()

router = APIRouter()


class ExportRequest(BaseModel):
    format: str = "markdown"  # "pdf", "markdown", "json"
    include_transcript: bool = True
    include_summary: bool = True


@router.get("/{meeting_id}/export")
async def export_meeting(
    request: Request,
    meeting_id: str,
    format: str = "markdown",
    include_transcript: bool = True,
    include_summary: bool = True
):
    """Export meeting data in various formats."""
    db = request.app.state.db

    # Get meeting data
    meeting = await db.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Get transcript if requested
    transcript = None
    if include_transcript:
        transcript = await db.get_transcript(meeting_id)

    # Get summary if requested
    summary = None
    if include_summary:
        summary = await db.get_summary(meeting_id)

    # Export based on format
    if format == "json":
        return _export_json(meeting, transcript, summary)
    elif format == "markdown":
        return _export_markdown(meeting, transcript, summary)
    elif format == "pdf":
        return await _export_pdf(meeting, transcript, summary)
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format: {format}. Use: json, markdown, pdf"
        )


def _export_json(meeting: dict, transcript: list, summary: dict) -> Response:
    """Export as JSON."""
    data = {
        "meeting": {
            "id": str(meeting["id"]),
            "conference_id": meeting["conference_id"],
            "title": meeting.get("title"),
            "started_at": meeting["started_at"].isoformat() if meeting.get("started_at") else None,
            "ended_at": meeting["ended_at"].isoformat() if meeting.get("ended_at") else None,
            "duration_seconds": meeting.get("duration_seconds"),
            "status": meeting["status"]
        },
        "transcript": [
            {
                "start_time": s["start_time"],
                "end_time": s["end_time"],
                "speaker": s.get("speaker_label"),
                "text": s["text"]
            }
            for s in (transcript or [])
        ] if transcript else None,
        "summary": {
            "text": summary["summary_text"],
            "key_points": summary["key_points"],
            "action_items": summary["action_items"],
            "decisions": summary["decisions"],
            "topics": summary["topics"],
            "sentiment": summary.get("sentiment")
        } if summary else None,
        "exported_at": datetime.utcnow().isoformat()
    }

    filename = f"meeting-{meeting['conference_id']}-{datetime.utcnow().strftime('%Y%m%d')}.json"

    return Response(
        content=json.dumps(data, indent=2),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )


def _export_markdown(meeting: dict, transcript: list, summary: dict) -> Response:
    """Export as Markdown."""
    lines = []

    # Header
    title = meeting.get("title") or f"Meeting: {meeting['conference_id']}"
    lines.append(f"# {title}")
    lines.append("")

    # Metadata
    lines.append("## Meeting Details")
    lines.append("")
    lines.append(f"- **Conference ID:** {meeting['conference_id']}")
    if meeting.get("started_at"):
        lines.append(f"- **Date:** {meeting['started_at'].strftime('%Y-%m-%d %H:%M UTC')}")
    if meeting.get("duration_seconds"):
        minutes = meeting["duration_seconds"] // 60
        lines.append(f"- **Duration:** {minutes} minutes")
    lines.append(f"- **Status:** {meeting['status']}")
    lines.append("")

    # Summary
    if summary:
        lines.append("## Summary")
        lines.append("")
        lines.append(summary["summary_text"])
        lines.append("")

        # Key Points
        if summary.get("key_points"):
            lines.append("### Key Points")
            lines.append("")
            for point in summary["key_points"]:
                lines.append(f"- {point}")
            lines.append("")

        # Action Items
        if summary.get("action_items"):
            lines.append("### Action Items")
            lines.append("")
            for item in summary["action_items"]:
                task = item.get("task", item) if isinstance(item, dict) else item
                assignee = item.get("assignee", "") if isinstance(item, dict) else ""
                checkbox = "[ ]"
                if assignee:
                    lines.append(f"- {checkbox} {task} *(Assigned: {assignee})*")
                else:
                    lines.append(f"- {checkbox} {task}")
            lines.append("")

        # Decisions
        if summary.get("decisions"):
            lines.append("### Decisions")
            lines.append("")
            for decision in summary["decisions"]:
                lines.append(f"- {decision}")
            lines.append("")

    # Transcript
    if transcript:
        lines.append("## Transcript")
        lines.append("")

        current_speaker = None
        for segment in transcript:
            speaker = segment.get("speaker_label") or "Speaker"
            time_str = _format_time(segment["start_time"])

            if speaker != current_speaker:
                lines.append("")
                lines.append(f"**{speaker}** *({time_str})*")
                current_speaker = speaker

            lines.append(f"> {segment['text']}")

        lines.append("")

    # Footer
    lines.append("---")
    lines.append(f"*Exported on {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')} by Meeting Intelligence*")

    content = "\n".join(lines)
    filename = f"meeting-{meeting['conference_id']}-{datetime.utcnow().strftime('%Y%m%d')}.md"

    return Response(
        content=content,
        media_type="text/markdown",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )


async def _export_pdf(meeting: dict, transcript: list, summary: dict) -> StreamingResponse:
    """Export as PDF using reportlab."""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="PDF export requires reportlab. Use markdown or json format."
        )

    buffer = io.BytesIO()

    # Create PDF document
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=72,
        leftMargin=72,
        topMargin=72,
        bottomMargin=72
    )

    styles = getSampleStyleSheet()
    story = []

    # Title
    title = meeting.get("title") or f"Meeting: {meeting['conference_id']}"
    story.append(Paragraph(title, styles['Title']))
    story.append(Spacer(1, 12))

    # Metadata
    story.append(Paragraph("Meeting Details", styles['Heading2']))
    if meeting.get("started_at"):
        story.append(Paragraph(
            f"Date: {meeting['started_at'].strftime('%Y-%m-%d %H:%M UTC')}",
            styles['Normal']
        ))
    if meeting.get("duration_seconds"):
        minutes = meeting["duration_seconds"] // 60
        story.append(Paragraph(f"Duration: {minutes} minutes", styles['Normal']))
    story.append(Spacer(1, 12))

    # Summary
    if summary:
        story.append(Paragraph("Summary", styles['Heading2']))
        story.append(Paragraph(summary["summary_text"], styles['Normal']))
        story.append(Spacer(1, 12))

        if summary.get("key_points"):
            story.append(Paragraph("Key Points", styles['Heading3']))
            for point in summary["key_points"]:
                story.append(Paragraph(f"• {point}", styles['Normal']))
            story.append(Spacer(1, 12))

        if summary.get("action_items"):
            story.append(Paragraph("Action Items", styles['Heading3']))
            for item in summary["action_items"]:
                task = item.get("task", item) if isinstance(item, dict) else item
                story.append(Paragraph(f"☐ {task}", styles['Normal']))
            story.append(Spacer(1, 12))

    # Transcript (abbreviated for PDF)
    if transcript:
        story.append(Paragraph("Transcript", styles['Heading2']))
        current_speaker = None

        for segment in transcript[:100]:  # Limit segments for PDF
            speaker = segment.get("speaker_label") or "Speaker"

            if speaker != current_speaker:
                story.append(Spacer(1, 6))
                story.append(Paragraph(
                    f"<b>{speaker}</b> ({_format_time(segment['start_time'])})",
                    styles['Normal']
                ))
                current_speaker = speaker

            story.append(Paragraph(segment['text'], styles['Normal']))

        if len(transcript) > 100:
            story.append(Spacer(1, 12))
            story.append(Paragraph(
                f"[... {len(transcript) - 100} more segments not shown in PDF]",
                styles['Normal']
            ))

    # Build PDF
    doc.build(story)
    buffer.seek(0)

    filename = f"meeting-{meeting['conference_id']}-{datetime.utcnow().strftime('%Y%m%d')}.pdf"

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )


def _format_time(seconds: float) -> str:
    """Format seconds as HH:MM:SS or MM:SS."""
    total_seconds = int(seconds)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60

    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"
