-- Hand-written migration: updated_at triggers and plan-version immutability (ADR-0008).
CREATE TRIGGER plans_set_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER plan_versions_set_updated_at
  BEFORE UPDATE ON plan_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER plan_assignments_set_updated_at
  BEFORE UPDATE ON plan_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER quota_overrides_set_updated_at
  BEFORE UPDATE ON quota_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- A published or retired version can only move from published to retired. Its terms
-- (price, period, plan, number) and its limits never change, so an organization's
-- assignment always means what it meant when it was made.
CREATE FUNCTION plan_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'plan version % is published and cannot be deleted', OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (
       NEW.plan_id IS DISTINCT FROM OLD.plan_id OR
       NEW.version IS DISTINCT FROM OLD.version OR
       NEW.price_minor IS DISTINCT FROM OLD.price_minor OR
       NEW.currency IS DISTINCT FROM OLD.currency OR
       NEW.billing_period IS DISTINCT FROM OLD.billing_period OR
       NEW.published_at IS DISTINCT FROM OLD.published_at OR
       NOT (NEW.status = OLD.status OR (OLD.status = 'published' AND NEW.status = 'retired'))
     ) THEN
    RAISE EXCEPTION 'plan version % is published and immutable; publish a new version', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER plan_versions_immutable
  BEFORE UPDATE OR DELETE ON plan_versions
  FOR EACH ROW EXECUTE FUNCTION plan_version_guard();
--> statement-breakpoint
CREATE FUNCTION plan_version_limits_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND
     (SELECT status FROM plan_versions WHERE id = OLD.plan_version_id) IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'limits of a published plan version are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND
     (SELECT status FROM plan_versions WHERE id = NEW.plan_version_id) IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'limits of a published plan version are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER plan_version_limits_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON plan_version_limits
  FOR EACH ROW EXECUTE FUNCTION plan_version_limits_guard();
