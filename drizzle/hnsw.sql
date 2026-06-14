-- Run AFTER `drizzle-kit push`. Vector ANN indexes can't be expressed in the
-- Drizzle schema, so apply them here. HNSW needs no training step (unlike
-- IVFFlat) and gives better recall at hackathon data sizes.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX IF NOT EXISTS idx_email_vectors_hnsw
  ON email_vectors USING hnsw (embedding vector_cosine_ops);

-- Full-text keyword search over subject + snippet (search mode 2).
CREATE INDEX IF NOT EXISTS idx_emails_fts
  ON emails USING gin (
    to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(body_snippet, ''))
  );

-- Calendar conflict-detection range scans.
CREATE INDEX IF NOT EXISTS idx_calendar_events_range
  ON calendar_events (calendar_id, start_time, end_time)
  WHERE status <> 'cancelled';
