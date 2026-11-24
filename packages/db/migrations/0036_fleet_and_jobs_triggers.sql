-- Hand-written migration: updated_at triggers for fleet operations and the job board (ADR-0029).
CREATE TRIGGER fleet_incidents_set_updated_at
  BEFORE UPDATE ON fleet_incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER fleet_expenses_set_updated_at
  BEFORE UPDATE ON fleet_expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER fleet_preferred_providers_set_updated_at
  BEFORE UPDATE ON fleet_preferred_providers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER jobs_set_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER job_applications_set_updated_at
  BEFORE UPDATE ON job_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
