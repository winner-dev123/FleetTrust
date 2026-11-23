-- Hand-written migration: updated_at triggers for the emergency tables (ADR-0025).
CREATE TRIGGER emergency_guidance_set_updated_at
  BEFORE UPDATE ON emergency_guidance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trusted_contacts_set_updated_at
  BEFORE UPDATE ON trusted_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER emergency_incidents_set_updated_at
  BEFORE UPDATE ON emergency_incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER incident_recipients_set_updated_at
  BEFORE UPDATE ON incident_recipients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER incident_deliveries_set_updated_at
  BEFORE UPDATE ON incident_deliveries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER provider_emergency_settings_set_updated_at
  BEFORE UPDATE ON provider_emergency_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
