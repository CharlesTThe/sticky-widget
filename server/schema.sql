-- feedback-kit: one table. Run once, or let postgresStore(pool).migrate() do it.
--
-- `data` holds the comment exactly as the widget sent it (anchor, rewrite, context and all),
-- so a newer widget's extra fields survive an older server. The other columns are copies of
-- the parts worth querying and indexing.
--
-- A deleted comment keeps its row with `deleted_at` set: that is its tombstone. Dropping the
-- row would let a browser that still holds the comment upload it again.

CREATE TABLE IF NOT EXISTS feedback_comments (
  id           TEXT PRIMARY KEY,
  page         TEXT NOT NULL,
  data         JSONB NOT NULL,
  author_name  TEXT,
  author_email TEXT,
  text         TEXT,
  resolved     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL,
  deleted_at   TIMESTAMPTZ,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feedback_comments_page_idx ON feedback_comments (page);
CREATE INDEX IF NOT EXISTS feedback_comments_updated_idx ON feedback_comments (updated_at DESC);
