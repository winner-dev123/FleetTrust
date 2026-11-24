-- Hand-written migration: appointment double-booking guard and updated_at triggers (ADR-0027).
-- btree_gist lets a GiST exclusion constraint compare UUIDs with "=". Cloud SQL supports it.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- One staff member can never hold two overlapping booked appointments. Enforced by the database,
-- so concurrent bookings can't both succeed. Half-open ranges: back-to-back slots are allowed.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_staff_no_overlap
  EXCLUDE USING gist (staff_user_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status = 'booked');
--> statement-breakpoint
CREATE TRIGGER crm_inquiry_states_set_updated_at
  BEFORE UPDATE ON crm_inquiry_states
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER appointments_set_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER crm_tasks_set_updated_at
  BEFORE UPDATE ON crm_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER staff_availability_set_updated_at
  BEFORE UPDATE ON staff_availability
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
