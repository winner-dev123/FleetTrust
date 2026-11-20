-- Hand-written migration: updated_at triggers for catalog and opening-hours tables (data conventions).
CREATE TRIGGER provider_offerings_set_updated_at
  BEFORE UPDATE ON provider_offerings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER branch_opening_hours_set_updated_at
  BEFORE UPDATE ON branch_opening_hours
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER branch_hours_exceptions_set_updated_at
  BEFORE UPDATE ON branch_hours_exceptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
