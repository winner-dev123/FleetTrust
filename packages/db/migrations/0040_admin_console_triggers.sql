-- Hand-written migration: updated_at triggers for the admin settings tables (ADR-0033).
CREATE TRIGGER feature_settings_set_updated_at
  BEFORE UPDATE ON feature_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER service_category_settings_set_updated_at
  BEFORE UPDATE ON service_category_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
