-- Hand-written migration: updated_at triggers for the vehicle tables (ADR-0026).
CREATE TRIGGER vehicles_set_updated_at
  BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER vehicle_assignments_set_updated_at
  BEFORE UPDATE ON vehicle_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER service_records_set_updated_at
  BEFORE UPDATE ON service_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER maintenance_schedules_set_updated_at
  BEFORE UPDATE ON maintenance_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER vehicle_documents_set_updated_at
  BEFORE UPDATE ON vehicle_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER vehicle_document_shares_set_updated_at
  BEFORE UPDATE ON vehicle_document_shares
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
