-- Hand-written migration: extensions and shared functions used by later tables.
-- Cloud SQL: CREATE EXTENSION postgis requires the cloudsqlsuperuser role (the default admin user has it).

CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint

-- Keeps updated_at honest even for rows changed by raw SQL. Attach to every table with updated_at:
--   CREATE TRIGGER <table>_set_updated_at BEFORE UPDATE ON <table>
--     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Makes a table append-only. Attach as BEFORE UPDATE OR DELETE (and BEFORE TRUNCATE) triggers.
CREATE OR REPLACE FUNCTION reject_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
