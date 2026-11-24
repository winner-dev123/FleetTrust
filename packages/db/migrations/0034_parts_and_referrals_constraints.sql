-- Hand-written migration: referral audit guard and updated_at triggers (ADR-0028).
-- A referral's disclosure (who, why, which relationship) is what the customer consents to, so
-- it can never change after creation. A decision (consented, declined, withdrawn) is final.
-- The only later changes allowed are the ON DELETE SET NULL actions of its foreign keys.
CREATE FUNCTION provider_referrals_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only as part of deleting the whole request (ON DELETE CASCADE).
    IF EXISTS (SELECT 1 FROM service_requests WHERE id = OLD.request_id) THEN
      RAISE EXCEPTION 'provider_referrals rows cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.from_organization_id IS DISTINCT FROM OLD.from_organization_id
     OR NEW.from_recipient_id IS DISTINCT FROM OLD.from_recipient_id
     OR NEW.to_organization_id IS DISTINCT FROM OLD.to_organization_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.relationship IS DISTINCT FROM OLD.relationship
     OR NEW.relationship_details IS DISTINCT FROM OLD.relationship_details THEN
    RAISE EXCEPTION 'a referral''s disclosure cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'pending_consent' AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.share_photos IS DISTINCT FROM OLD.share_photos
       OR NEW.share_outcome IS DISTINCT FROM OLD.share_outcome
       OR NEW.consent_text IS DISTINCT FROM OLD.consent_text
       OR NEW.consent_version IS DISTINCT FROM OLD.consent_version
       OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR (NEW.decided_by IS DISTINCT FROM OLD.decided_by AND NEW.decided_by IS NOT NULL)
       OR (NEW.recipient_id IS DISTINCT FROM OLD.recipient_id AND NEW.recipient_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'a referral decision is final' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER provider_referrals_guard_update
  BEFORE UPDATE ON provider_referrals
  FOR EACH ROW EXECUTE FUNCTION provider_referrals_guard();
--> statement-breakpoint
CREATE TRIGGER provider_referrals_guard_delete
  BEFORE DELETE ON provider_referrals
  FOR EACH ROW EXECUTE FUNCTION provider_referrals_guard();
--> statement-breakpoint
CREATE TRIGGER provider_referrals_set_updated_at
  BEFORE UPDATE ON provider_referrals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER parts_set_updated_at
  BEFORE UPDATE ON parts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER part_inquiries_set_updated_at
  BEFORE UPDATE ON part_inquiries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
