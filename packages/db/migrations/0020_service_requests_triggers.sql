-- Hand-written migration: updated_at triggers and the append-only request history (ADR-0021).
CREATE TRIGGER service_requests_set_updated_at
  BEFORE UPDATE ON service_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER service_request_recipients_set_updated_at
  BEFORE UPDATE ON service_request_recipients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER service_quotes_set_updated_at
  BEFORE UPDATE ON service_quotes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER service_request_attachments_set_updated_at
  BEFORE UPDATE ON service_request_attachments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- History rows can't be edited. Deleting is allowed only as part of deleting the whole request
-- (the ON DELETE CASCADE), which is when the parent row no longer exists.
CREATE FUNCTION service_request_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'service_request_events is append-only' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM service_requests WHERE id = OLD.request_id) THEN
    RAISE EXCEPTION 'service_request_events is append-only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER service_request_events_no_update
  BEFORE UPDATE ON service_request_events
  FOR EACH ROW EXECUTE FUNCTION service_request_events_append_only();
--> statement-breakpoint
CREATE TRIGGER service_request_events_no_delete
  BEFORE DELETE ON service_request_events
  FOR EACH ROW EXECUTE FUNCTION service_request_events_append_only();
