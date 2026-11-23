-- Hand-written migration: updated_at triggers for the messaging tables (ADR-0024).
CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER messages_set_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER message_attachments_set_updated_at
  BEFORE UPDATE ON message_attachments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER conversation_states_set_updated_at
  BEFORE UPDATE ON conversation_states
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER messaging_preferences_set_updated_at
  BEFORE UPDATE ON messaging_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER push_devices_set_updated_at
  BEFORE UPDATE ON push_devices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
