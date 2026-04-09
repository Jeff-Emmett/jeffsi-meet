"""
Authentication helpers for per-meeting access control.

Each meeting has a unique access_token. Knowing the conference_id (room name)
lets a client discover the token via GET /meetings/token?conference_id=<room>.
All other endpoints require a valid token to return data.
"""

from typing import List, Optional

from fastapi import HTTPException, Request

import structlog

log = structlog.get_logger()


def get_bearer_token(request: Request) -> Optional[str]:
    """Extract Bearer token from Authorization header."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def get_multi_tokens(request: Request) -> List[str]:
    """Extract comma-separated tokens from X-MI-Tokens header."""
    raw = request.headers.get("X-MI-Tokens", "")
    if not raw:
        return []
    return [t.strip() for t in raw.split(",") if t.strip()]


async def validate_meeting_access(
    request: Request,
    meeting_id: str,
) -> None:
    """Verify the Bearer token matches the meeting's access_token.

    Raises 403 if the token is missing or doesn't match.
    """
    token = get_bearer_token(request)
    if not token:
        raise HTTPException(status_code=403, detail="Missing access token")

    db = request.app.state.db
    stored_token = await db.get_meeting_access_token(meeting_id)

    if not stored_token or token != stored_token:
        raise HTTPException(status_code=403, detail="Invalid access token")
