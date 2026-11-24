"use client";

import type { ApiClient } from "@fleettrust/sdk";
import { onAuthStateChanged, signOut as firebaseSignOut } from "@firebase/auth";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { apiClient, firebaseAuth } from "./firebase";

export interface SessionUser {
  uid: string;
  email: string | null;
}

/** Who is signed in on this device. Profile and organizations load inside /app (AccountProvider). */
export interface Session {
  status: "loading" | "signed-in" | "signed-out";
  user: SessionUser | null;
  /** API client that sends the current ID token (works signed out for public endpoints). */
  api: ApiClient;
  signOut: () => Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

/** Tracks Firebase Auth in the browser. Rendered once, in the root layout. */
export function FirebaseSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Pick<Session, "status" | "user">>({
    status: "loading",
    user: null,
  });

  useEffect(
    () =>
      onAuthStateChanged(firebaseAuth(), (user) => {
        setState(
          user
            ? { status: "signed-in", user: { uid: user.uid, email: user.email } }
            : { status: "signed-out", user: null },
        );
      }),
    [],
  );

  const session = useMemo<Session>(
    () => ({
      ...state,
      api: apiClient(),
      signOut: () => firebaseSignOut(firebaseAuth()),
    }),
    [state],
  );
  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession() needs a session provider");
  return session;
}
