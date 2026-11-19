-- Hand-written migration: updated_at triggers for verification tables (data conventions).
CREATE TRIGGER verification_cases_set_updated_at
  BEFORE UPDATE ON verification_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER verification_documents_set_updated_at
  BEFORE UPDATE ON verification_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER verification_badges_set_updated_at
  BEFORE UPDATE ON verification_badges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER verification_appeals_set_updated_at
  BEFORE UPDATE ON verification_appeals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
