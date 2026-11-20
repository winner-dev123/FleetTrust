-- Hand-written migration: updated_at triggers for provider profile tables (data conventions).
CREATE TRIGGER provider_profiles_set_updated_at
  BEFORE UPDATE ON provider_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER provider_media_set_updated_at
  BEFORE UPDATE ON provider_media
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
