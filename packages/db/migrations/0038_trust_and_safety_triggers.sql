-- Hand-written migration: sanction history guard and updated_at triggers (ADR-0030).
-- Sanctions are history: they can be lifted or overturned (an UPDATE), never deleted, except
-- when the member's account itself is deleted (ON DELETE CASCADE).
CREATE FUNCTION member_sanctions_keep() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
    RAISE EXCEPTION 'member_sanctions rows cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER member_sanctions_no_delete
  BEFORE DELETE ON member_sanctions
  FOR EACH ROW EXECUTE FUNCTION member_sanctions_keep();
--> statement-breakpoint
CREATE TRIGGER power_user_status_set_updated_at
  BEFORE UPDATE ON power_user_status
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER member_sanctions_set_updated_at
  BEFORE UPDATE ON member_sanctions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER moderation_appeals_set_updated_at
  BEFORE UPDATE ON moderation_appeals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
