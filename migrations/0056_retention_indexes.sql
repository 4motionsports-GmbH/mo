-- 0056_retention_indexes.sql — indexes for the nightly retention deletes.
--
-- /api/cron/retention purges email_messages by occurred_at and physical_letters
-- by created_at once a day; neither table had an index on its window column, so
-- each run scanned the whole table (small today, growing with every reply and
-- letter). Both indexes are additive and safe to apply at any time.

CREATE INDEX IF NOT EXISTS email_messages_occurred_at_idx
  ON email_messages (occurred_at);

CREATE INDEX IF NOT EXISTS physical_letters_created_at_idx
  ON physical_letters (created_at);
