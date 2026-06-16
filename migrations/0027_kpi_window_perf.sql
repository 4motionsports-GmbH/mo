-- 0027_kpi_window_perf.sql — index conversations(created_at) for the windowed
-- admin KPI dashboard (lib/kpi-store.getCoreMetrics).
--
-- getCoreMetrics now scopes ALL of its metrics to the selected `days` window
-- (matching the daily-activity chart beside them), instead of several of them
-- scanning the ENTIRE conversations / kpi_events history on every dashboard
-- load. kpi_events already has a created_at index (migration 0001:
-- kpi_events_created_at_idx), so its three windowed aggregates (CTA/cart clicks,
-- distinct sessions, top events) are already served by it.
--
-- conversations had NO created_at index — its windowed total/avg, the status
-- breakdown, and the (already-windowed) daily series all filtered on created_at
-- via a sequential scan. This adds the missing btree so those range filters
-- become index scans.
--
-- Plain non-unique btree on a monotonic timestamp column: cheap to build, makes
-- no assumptions about the data, safe to run on a live table.
CREATE INDEX IF NOT EXISTS conversations_created_at_idx
  ON conversations (created_at);
