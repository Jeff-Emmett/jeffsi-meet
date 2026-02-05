-- Meeting Intelligence System - PostgreSQL Schema
-- Uses pgvector extension for semantic search

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================
-- Meetings Table
-- ============================================================
CREATE TABLE meetings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conference_id VARCHAR(255) NOT NULL,
    conference_name VARCHAR(255),
    title VARCHAR(500),
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    recording_path VARCHAR(1000),
    audio_path VARCHAR(1000),
    status VARCHAR(50) DEFAULT 'recording',
    -- Status: 'recording', 'extracting_audio', 'transcribing', 'diarizing', 'summarizing', 'ready', 'failed'
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_meetings_conference_id ON meetings(conference_id);
CREATE INDEX idx_meetings_status ON meetings(status);
CREATE INDEX idx_meetings_started_at ON meetings(started_at DESC);
CREATE INDEX idx_meetings_created_at ON meetings(created_at DESC);

-- ============================================================
-- Meeting Participants
-- ============================================================
CREATE TABLE meeting_participants (
    id SERIAL PRIMARY KEY,
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    participant_id VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    email VARCHAR(255),
    joined_at TIMESTAMP WITH TIME ZONE,
    left_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    is_moderator BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_participants_meeting_id ON meeting_participants(meeting_id);
CREATE INDEX idx_participants_participant_id ON meeting_participants(participant_id);

-- ============================================================
-- Transcripts
-- ============================================================
CREATE TABLE transcripts (
    id SERIAL PRIMARY KEY,
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    segment_index INTEGER NOT NULL,
    start_time FLOAT NOT NULL,
    end_time FLOAT NOT NULL,
    speaker_id VARCHAR(255),
    speaker_name VARCHAR(255),
    speaker_label VARCHAR(50), -- e.g., "Speaker 1", "Speaker 2"
    text TEXT NOT NULL,
    confidence FLOAT,
    language VARCHAR(10) DEFAULT 'en',
    word_timestamps JSONB, -- Array of {word, start, end, confidence}
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_transcripts_meeting_id ON transcripts(meeting_id);
CREATE INDEX idx_transcripts_speaker_id ON transcripts(speaker_id);
CREATE INDEX idx_transcripts_start_time ON transcripts(meeting_id, start_time);
CREATE INDEX idx_transcripts_text_search ON transcripts USING gin(to_tsvector('english', text));

-- ============================================================
-- Transcript Embeddings (for semantic search)
-- ============================================================
CREATE TABLE transcript_embeddings (
    id SERIAL PRIMARY KEY,
    transcript_id INTEGER NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    embedding vector(384), -- all-MiniLM-L6-v2 dimensions
    chunk_text TEXT, -- The text chunk this embedding represents
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_embeddings_transcript_id ON transcript_embeddings(transcript_id);
CREATE INDEX idx_embeddings_meeting_id ON transcript_embeddings(meeting_id);
CREATE INDEX idx_embeddings_vector ON transcript_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================
-- AI Summaries
-- ============================================================
CREATE TABLE summaries (
    id SERIAL PRIMARY KEY,
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    summary_text TEXT,
    key_points JSONB, -- Array of key point strings
    action_items JSONB, -- Array of {task, assignee, due_date, completed}
    decisions JSONB, -- Array of decision strings
    topics JSONB, -- Array of {topic, duration_seconds, relevance_score}
    sentiment VARCHAR(50), -- 'positive', 'neutral', 'negative', 'mixed'
    sentiment_scores JSONB, -- {positive: 0.7, neutral: 0.2, negative: 0.1}
    participants_summary JSONB, -- {participant_id: {speaking_time, word_count, topics}}
    model_used VARCHAR(100),
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_summaries_meeting_id ON summaries(meeting_id);
CREATE INDEX idx_summaries_generated_at ON summaries(generated_at DESC);

-- ============================================================
-- Processing Jobs Queue
-- ============================================================
CREATE TABLE processing_jobs (
    id SERIAL PRIMARY KEY,
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    job_type VARCHAR(50) NOT NULL, -- 'extract_audio', 'transcribe', 'diarize', 'summarize', 'embed'
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed', 'cancelled'
    priority INTEGER DEFAULT 5, -- 1 = highest, 10 = lowest
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    result JSONB,
    worker_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_jobs_meeting_id ON processing_jobs(meeting_id);
CREATE INDEX idx_jobs_status ON processing_jobs(status, priority, created_at);
CREATE INDEX idx_jobs_type_status ON processing_jobs(job_type, status);

-- ============================================================
-- Search History (for analytics)
-- ============================================================
CREATE TABLE search_history (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255),
    query TEXT NOT NULL,
    search_type VARCHAR(50), -- 'text', 'semantic', 'combined'
    results_count INTEGER,
    meeting_ids UUID[],
    filters JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_search_history_created_at ON search_history(created_at DESC);

-- ============================================================
-- Webhook Events (for Jibri callbacks)
-- ============================================================
CREATE TABLE webhook_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_webhooks_processed ON webhook_events(processed, created_at);

-- ============================================================
-- Functions
-- ============================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER meetings_updated_at
    BEFORE UPDATE ON meetings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER jobs_updated_at
    BEFORE UPDATE ON processing_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Semantic search function
CREATE OR REPLACE FUNCTION semantic_search(
    query_embedding vector(384),
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 10,
    meeting_filter UUID DEFAULT NULL
)
RETURNS TABLE (
    transcript_id INT,
    meeting_id UUID,
    chunk_text TEXT,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        te.transcript_id,
        te.meeting_id,
        te.chunk_text,
        1 - (te.embedding <=> query_embedding) AS similarity
    FROM transcript_embeddings te
    WHERE
        (meeting_filter IS NULL OR te.meeting_id = meeting_filter)
        AND 1 - (te.embedding <=> query_embedding) > match_threshold
    ORDER BY te.embedding <=> query_embedding
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- Full-text search function
CREATE OR REPLACE FUNCTION fulltext_search(
    search_query TEXT,
    meeting_filter UUID DEFAULT NULL,
    match_count INT DEFAULT 50
)
RETURNS TABLE (
    transcript_id INT,
    meeting_id UUID,
    text TEXT,
    speaker_name VARCHAR,
    start_time FLOAT,
    rank FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.meeting_id,
        t.text,
        t.speaker_name,
        t.start_time,
        ts_rank(to_tsvector('english', t.text), plainto_tsquery('english', search_query)) AS rank
    FROM transcripts t
    WHERE
        (meeting_filter IS NULL OR t.meeting_id = meeting_filter)
        AND to_tsvector('english', t.text) @@ plainto_tsquery('english', search_query)
    ORDER BY rank DESC
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Views
-- ============================================================

-- Meeting overview with stats
CREATE VIEW meeting_overview AS
SELECT
    m.id,
    m.conference_id,
    m.conference_name,
    m.title,
    m.started_at,
    m.ended_at,
    m.duration_seconds,
    m.status,
    m.recording_path,
    COUNT(DISTINCT mp.id) AS participant_count,
    COUNT(DISTINCT t.id) AS transcript_segment_count,
    COALESCE(SUM(LENGTH(t.text)), 0) AS total_characters,
    s.id IS NOT NULL AS has_summary,
    m.created_at
FROM meetings m
LEFT JOIN meeting_participants mp ON m.id = mp.meeting_id
LEFT JOIN transcripts t ON m.id = t.meeting_id
LEFT JOIN summaries s ON m.id = s.meeting_id
GROUP BY m.id, s.id;

-- Speaker stats per meeting
CREATE VIEW speaker_stats AS
SELECT
    t.meeting_id,
    t.speaker_id,
    t.speaker_name,
    t.speaker_label,
    COUNT(*) AS segment_count,
    SUM(t.end_time - t.start_time) AS speaking_time_seconds,
    SUM(LENGTH(t.text)) AS character_count,
    SUM(array_length(regexp_split_to_array(t.text, '\s+'), 1)) AS word_count
FROM transcripts t
GROUP BY t.meeting_id, t.speaker_id, t.speaker_name, t.speaker_label;

-- ============================================================
-- Sample Data (for testing - remove in production)
-- ============================================================

-- INSERT INTO meetings (conference_id, conference_name, title, started_at, status)
-- VALUES ('test-room-123', 'Test Room', 'Test Meeting', NOW() - INTERVAL '1 hour', 'ready');

COMMENT ON TABLE meetings IS 'Stores meeting metadata and processing status';
COMMENT ON TABLE transcripts IS 'Stores time-stamped transcript segments with speaker attribution';
COMMENT ON TABLE summaries IS 'Stores AI-generated meeting summaries and extracted information';
COMMENT ON TABLE transcript_embeddings IS 'Stores vector embeddings for semantic search';
COMMENT ON TABLE processing_jobs IS 'Job queue for async processing tasks';
