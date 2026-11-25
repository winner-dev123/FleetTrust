import type { ApiClient } from "@fleettrust/sdk";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { clearUserData, DraftStore } from "../lib/drafts";
import { MessageOutbox } from "../lib/outbox";
import { registerPush, unregisterPush } from "../lib/push";
import type { Runtime } from "../platform/runtime";
import type { AuthUser, Platform } from "../platform/types";

export interface Session {
  status: "loading" | "signed-in" | "signed-out";
  user: AuthUser | null;
  api: ApiClient;
  platform: Platform;
  runtime: Runtime;
  drafts: DraftStore;
  /** Queued chat messages for the signed-in user (null when signed out). */
  outbox: MessageOutbox | null;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

/** Tracks Firebase Auth on the device, and registers for push after sign-in. */
export function SessionProvider({ runtime, children }: { runtime: Runtime; children: ReactNode }) {
  const { platform, api } = runtime;
  const [state, setState] = useState<Pick<Session, "status" | "user">>({
    status: "loading",
    user: null,
  });

  useEffect(
    () =>
      platform.auth.subscribe((user) => {
        setState(user ? { status: "signed-in", user } : { status: "signed-out", user: null });
      }),
    [platform],
  );

  const uid = state.user?.uid ?? null;
  useEffect(() => {
    if (uid === null) return;
    // The first /v1/me call after sign-in creates the account; push registration needs it.
    void api
      .me()
      .then(() => registerPush(platform, api))
      .catch(() => undefined);
  }, [api, platform, uid]);

  const session = useMemo<Session>(() => {
    const drafts = new DraftStore(platform.storage);
    const outbox =
      uid === null
        ? null
        : new MessageOutbox(platform.storage, uid, (conversationId, message) =>
            api.sendMessage(conversationId, message),
          );
    return {
      ...state,
      api,
      platform,
      runtime,
      drafts,
      outbox,
      signOut: async () => {
        // Order matters: unregister push while the token still works, then erase this
        // person's drafts and queued messages, then sign out of Firebase.
        await unregisterPush(platform, api);
        if (uid !== null) await clearUserData(platform.storage, uid).catch(() => 0);
        await platform.auth.signOut();
      },
    };
  }, [api, platform, runtime, state, uid]);

  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession() needs a SessionProvider");
  return session;
}
