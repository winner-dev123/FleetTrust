-- Hand-written migration: updated_at triggers for saved lists (data conventions).
CREATE TRIGGER saved_lists_set_updated_at
  BEFORE UPDATE ON saved_lists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER saved_list_members_set_updated_at
  BEFORE UPDATE ON saved_list_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER saved_list_share_links_set_updated_at
  BEFORE UPDATE ON saved_list_share_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
