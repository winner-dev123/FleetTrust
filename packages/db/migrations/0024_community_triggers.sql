-- Hand-written migration: updated_at triggers for the community tables (ADR-0023).
CREATE TRIGGER social_settings_set_updated_at
  BEFORE UPDATE ON social_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER friend_requests_set_updated_at
  BEFORE UPDATE ON friend_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER community_groups_set_updated_at
  BEFORE UPDATE ON community_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER community_group_members_set_updated_at
  BEFORE UPDATE ON community_group_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
