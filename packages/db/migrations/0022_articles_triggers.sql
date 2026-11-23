-- Hand-written migration: updated_at triggers, the article search vector and the append-only
-- moderation history (ADR-0022).
CREATE TRIGGER articles_set_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER article_images_set_updated_at
  BEFORE UPDATE ON article_images
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER article_comments_set_updated_at
  BEFORE UPDATE ON article_comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER content_reports_set_updated_at
  BEFORE UPDATE ON content_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- Weighted full-text vector: title (A), summary and tags (B), body (C). The 'simple'
-- configuration (no stemming) works for every language the pilot may use.
CREATE FUNCTION articles_search_vector() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('simple', array_to_string(NEW.tags, ' ')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.body_text, '')), 'C');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER articles_search_vector
  BEFORE INSERT OR UPDATE OF title, summary, tags, body_text ON articles
  FOR EACH ROW EXECUTE FUNCTION articles_search_vector();
--> statement-breakpoint
-- Moderation decisions can never be edited or removed.
CREATE FUNCTION moderation_actions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'moderation_actions is append-only' USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER moderation_actions_no_update
  BEFORE UPDATE OR DELETE ON moderation_actions
  FOR EACH ROW EXECUTE FUNCTION moderation_actions_append_only();
