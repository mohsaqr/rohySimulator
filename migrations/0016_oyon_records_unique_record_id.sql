-- Oyon: make emotion-record ingestion idempotent.
-- Why: client retries (network blip), reconnects, and replayed batches all
-- POST the same window twice. Without deduplication the second copy is
-- silently inserted and inflates every analytics aggregate
-- (window_count, dominant distribution, mean valence/arousal). The
-- record_id column already exists (since 0011) but had no uniqueness
-- enforced. A partial unique index keyed on (tenant_id, session_id,
-- record_id) lets us use INSERT ... ON CONFLICT DO NOTHING in the route
-- handler so duplicates are dropped at the DB layer rather than counted.
-- The `WHERE record_id IS NOT NULL` clause keeps legacy rows + clients
-- that don't send a record_id unaffected — the index simply doesn't
-- cover them, so they fall back to plain INSERT semantics.

CREATE UNIQUE INDEX IF NOT EXISTS idx_oyon_records_unique_record_id
  ON oyon_emotion_records(tenant_id, session_id, record_id)
  WHERE record_id IS NOT NULL;
