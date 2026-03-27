CREATE TABLE IF NOT EXISTS feedback (
  id            TEXT PRIMARY KEY,
  timestamp     TIMESTAMPTZ NOT NULL,
  page_url      TEXT,
  selector      TEXT,
  tag_name      TEXT,
  element_id    TEXT,
  label         TEXT,
  rect          JSONB,
  selected_text TEXT,
  comment       TEXT NOT NULL,
  metadata      JSONB,
  user_name     TEXT,
  user_email    TEXT,
  console_logs  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback (created_at DESC);
