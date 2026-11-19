-- Hand-written migration: triggers for the foundation tables.

-- audit_events is append-only (SRS FR-09). Corrections are new events, never edits.
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();
--> statement-breakpoint

CREATE TRIGGER currencies_set_updated_at
  BEFORE UPDATE ON currencies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
