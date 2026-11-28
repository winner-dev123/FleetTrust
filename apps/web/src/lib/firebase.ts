"use client";

import { createApiClient } from "@fleettrust/sdk";
import { type FirebaseApp, getApps, initializeApp } from "@firebase/app";
import { type Auth, connectAuthEmulator, getAuth } from "@firebase/auth";

import { webEnv } from "@/env";

let auth: Auth | undefined;

/**
 * Lazily initialised Firebase Auth, browser only. Never call this during server rendering:
 * pages call it from effects and event handlers.
 */
export function firebaseAuth(): Auth {
  if (typeof window === "undefined") throw new Error("firebaseAuth() is browser-only");
  if (auth) return auth;
  const { firebase } = webEnv;
  const app: FirebaseApp =
    getApps()[0] ??
    initializeApp({
      apiKey: firebase.apiKey,
      authDomain: firebase.authDomain,
      projectId: firebase.projectId,
      ...(firebase.appId ? { appId: firebase.appId } : {}),
    });
  auth = getAuth(app);
  if (firebase.authEmulatorHost) {
    connectAuthEmulator(auth, `http://${firebase.authEmulatorHost}`, { disableWarnings: true });
  }
  return auth;
}

/** FleetTrust API client that attaches the signed-in user's (auto-refreshed) ID token. */
export function apiClient() {
  return createApiClient({
    baseUrl: webEnv.apiUrl,
    // The API scales to zero (ADR-0037): the first request after a quiet spell waits for it to
    // start, so allow well beyond a cold start before reporting "couldn't reach FleetTrust".
    timeoutMs: 30_000,
    getIdToken: async () => (await firebaseAuth().currentUser?.getIdToken()) ?? null,
  });
}
