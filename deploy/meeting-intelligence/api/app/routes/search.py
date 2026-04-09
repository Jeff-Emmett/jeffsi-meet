"""
Search routes for Meeting Intelligence.
"""

from typing import Optional, List

from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

from ..auth import get_multi_tokens
from ..config import settings

import structlog

log = structlog.get_logger()

router = APIRouter()

# Lazy-load embedding model
_embedding_model = None


def get_embedding_model():
    """Get or initialize the embedding model."""
    global _embedding_model
    if _embedding_model is None:
        log.info("Loading embedding model...", model=settings.embedding_model)
        _embedding_model = SentenceTransformer(settings.embedding_model)
        log.info("Embedding model loaded")
    return _embedding_model


class SearchResult(BaseModel):
    meeting_id: str
    meeting_title: Optional[str]
    text: str
    start_time: Optional[float]
    speaker_label: Optional[str]
    score: float
    search_type: str


class SearchResponse(BaseModel):
    query: str
    results: List[SearchResult]
    total: int
    search_type: str


class SearchRequest(BaseModel):
    query: str
    meeting_id: Optional[str] = None
    search_type: str = "combined"  # "text", "semantic", "combined"
    limit: int = 20


@router.post("", response_model=SearchResponse)
async def search_transcripts(request: Request, body: SearchRequest):
    """Search across meeting transcripts.

    Requires X-MI-Tokens header. Results are filtered to authorized meetings only.

    Search types:
    - text: Full-text search using PostgreSQL ts_vector
    - semantic: Semantic search using vector embeddings
    - combined: Both text and semantic search, merged results
    """
    db = request.app.state.db

    # Get authorized meeting IDs from tokens
    tokens = get_multi_tokens(request)
    authorized_meetings = set()
    if tokens:
        meetings = await db.list_meetings_by_tokens(tokens=tokens, limit=1000)
        authorized_meetings = {str(m["id"]) for m in meetings}

    if not body.query or len(body.query.strip()) < 2:
        raise HTTPException(
            status_code=400,
            detail="Query must be at least 2 characters"
        )

    results = []

    # Full-text search
    if body.search_type in ["text", "combined"]:
        text_results = await db.fulltext_search(
            query=body.query,
            meeting_id=body.meeting_id,
            limit=body.limit
        )

        for r in text_results:
            results.append(SearchResult(
                meeting_id=str(r["meeting_id"]),
                meeting_title=r.get("meeting_title"),
                text=r["text"],
                start_time=r.get("start_time"),
                speaker_label=r.get("speaker_label"),
                score=float(r["rank"]),
                search_type="text"
            ))

    # Semantic search
    if body.search_type in ["semantic", "combined"]:
        try:
            model = get_embedding_model()
            query_embedding = model.encode(body.query).tolist()

            semantic_results = await db.semantic_search(
                embedding=query_embedding,
                meeting_id=body.meeting_id,
                threshold=0.6,
                limit=body.limit
            )

            for r in semantic_results:
                results.append(SearchResult(
                    meeting_id=str(r["meeting_id"]),
                    meeting_title=r.get("meeting_title"),
                    text=r["chunk_text"],
                    start_time=r.get("start_time"),
                    speaker_label=r.get("speaker_label"),
                    score=float(r["similarity"]),
                    search_type="semantic"
                ))

        except Exception as e:
            log.error("Semantic search failed", error=str(e))
            if body.search_type == "semantic":
                raise HTTPException(
                    status_code=500,
                    detail=f"Semantic search failed: {str(e)}"
                )

    # Filter to authorized meetings only
    if authorized_meetings:
        results = [r for r in results if r.meeting_id in authorized_meetings]
    else:
        results = []

    # Deduplicate and sort by score
    seen = set()
    unique_results = []
    for r in sorted(results, key=lambda x: x.score, reverse=True):
        key = (r.meeting_id, r.text[:100])
        if key not in seen:
            seen.add(key)
            unique_results.append(r)

    return SearchResponse(
        query=body.query,
        results=unique_results[:body.limit],
        total=len(unique_results),
        search_type=body.search_type
    )


@router.get("/suggest")
async def search_suggestions(
    request: Request,
    q: str = Query(..., min_length=2)
):
    """Get search suggestions based on partial query."""
    db = request.app.state.db

    # Simple prefix search on common terms
    results = await db.fulltext_search(query=q, limit=5)

    # Extract unique phrases
    suggestions = []
    for r in results:
        # Get surrounding context
        text = r["text"]
        words = text.split()

        # Find matching words and get context
        for i, word in enumerate(words):
            if q.lower() in word.lower():
                start = max(0, i - 2)
                end = min(len(words), i + 3)
                phrase = " ".join(words[start:end])
                if phrase not in suggestions:
                    suggestions.append(phrase)
                    if len(suggestions) >= 5:
                        break

    return {"suggestions": suggestions}
