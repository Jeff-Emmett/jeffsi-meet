"""
Meeting management routes.
"""

from typing import Optional, List

from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel

import structlog

log = structlog.get_logger()

router = APIRouter()


class MeetingResponse(BaseModel):
    id: str
    conference_id: str
    conference_name: Optional[str]
    title: Optional[str]
    started_at: Optional[str]
    ended_at: Optional[str]
    duration_seconds: Optional[int]
    status: str
    created_at: str
    segment_count: Optional[int] = None
    participant_count: Optional[int] = None
    has_summary: Optional[bool] = None


class MeetingListResponse(BaseModel):
    meetings: List[MeetingResponse]
    total: int
    limit: int
    offset: int


@router.get("", response_model=MeetingListResponse)
async def list_meetings(
    request: Request,
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0, ge=0),
    status: Optional[str] = Query(default=None)
):
    """List all meetings with pagination."""
    db = request.app.state.db

    meetings = await db.list_meetings(limit=limit, offset=offset, status=status)

    return MeetingListResponse(
        meetings=[
            MeetingResponse(
                id=str(m["id"]),
                conference_id=m["conference_id"],
                conference_name=m.get("conference_name"),
                title=m.get("title"),
                started_at=m["started_at"].isoformat() if m.get("started_at") else None,
                ended_at=m["ended_at"].isoformat() if m.get("ended_at") else None,
                duration_seconds=m.get("duration_seconds"),
                status=m["status"],
                created_at=m["created_at"].isoformat()
            )
            for m in meetings
        ],
        total=len(meetings),  # TODO: Add total count query
        limit=limit,
        offset=offset
    )


@router.get("/{meeting_id}", response_model=MeetingResponse)
async def get_meeting(request: Request, meeting_id: str):
    """Get meeting details."""
    db = request.app.state.db

    meeting = await db.get_meeting(meeting_id)

    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    return MeetingResponse(
        id=str(meeting["id"]),
        conference_id=meeting["conference_id"],
        conference_name=meeting.get("conference_name"),
        title=meeting.get("title"),
        started_at=meeting["started_at"].isoformat() if meeting.get("started_at") else None,
        ended_at=meeting["ended_at"].isoformat() if meeting.get("ended_at") else None,
        duration_seconds=meeting.get("duration_seconds"),
        status=meeting["status"],
        created_at=meeting["created_at"].isoformat(),
        segment_count=meeting.get("segment_count"),
        participant_count=meeting.get("participant_count"),
        has_summary=meeting.get("summary_id") is not None
    )


@router.delete("/{meeting_id}")
async def delete_meeting(request: Request, meeting_id: str):
    """Delete a meeting and all associated data."""
    db = request.app.state.db

    meeting = await db.get_meeting(meeting_id)

    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # TODO: Implement cascade delete
    # For now, just mark as deleted
    await db.update_meeting(meeting_id, status="deleted")

    return {"status": "deleted", "meeting_id": meeting_id}
