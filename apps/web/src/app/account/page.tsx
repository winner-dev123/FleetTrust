"use client";

import type { MeResponse, MyOrganization } from "@fleettrust/types";
import { spacing, typography } from "@fleettrust/ui";
import { onAuthStateChanged, signOut } from "@firebase/auth";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useEffect, useState } from "react";

import { apiClient, firebaseAuth } from "@/lib/firebase";

/** Minimal account page: profile, optional display name, sign out, sign out everywhere. */
export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<MyOrganization[]>([]);

  useEffect(
    () =>
      onAuthStateChanged(firebaseAuth(), (user) => {
        if (!user) {
          router.replace("/sign-in");
          return;
        }
        apiClient()
          .me()
          .then((profile) => {
            setMe(profile);
            setName(profile.displayName ?? "");
          })
          .catch(() => {
            setMessage("Couldn't load your account. Please sign in again.");
          });
        apiClient()
          .myOrganizations()
          .then(setOrganizations)
          .catch(() => {
            setOrganizations([]);
          });
      }),
    [router],
  );

  async function saveName(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const updated = await apiClient().updateMe({ displayName: name.trim() === "" ? null : name });
      setMe(updated);
      setMessage("Saved.");
    } catch {
      setMessage("Display names must be 1–50 characters.");
    }
  }

  async function signOutEverywhere() {
    try {
      await apiClient().revokeAllSessions();
    } finally {
      await signOut(firebaseAuth());
    }
  }

  if (!me) return <main style={{ padding: spacing.xl }}>{message ?? "Loading…"}</main>;

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: `${spacing.xxl}px ${spacing.lg}px` }}>
      <h1 style={{ fontSize: typography.fontSize.xl }}>Your account</h1>
      <p>
        Signed in as <strong>{me.email ?? "your account"}</strong>
      </p>

      <form onSubmit={(event) => void saveName(event)}>
        <label htmlFor="display-name">Display name (shown when you post or join groups)</label>
        <input
          id="display-name"
          maxLength={50}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          style={{ width: "100%", padding: spacing.sm }}
        />
        <button type="submit" style={{ marginTop: spacing.sm, padding: spacing.sm }}>
          Save
        </button>
      </form>
      {message && <p role="status">{message}</p>}

      <h2 style={{ fontSize: typography.fontSize.lg, marginTop: spacing.xl }}>Organizations</h2>
      {organizations.length === 0 ? (
        <p>You're not a member of any organization yet.</p>
      ) : (
        <ul>
          {organizations.map((entry) => (
            <li key={entry.membershipId}>
              <strong>{entry.organization.name}</strong> ({entry.organization.kind}) · {entry.role}
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", gap: spacing.sm, marginTop: spacing.xl }}>
        <button
          type="button"
          onClick={() => void signOut(firebaseAuth())}
          style={{ padding: spacing.sm }}
        >
          Sign out
        </button>
        <button
          type="button"
          onClick={() => void signOutEverywhere()}
          style={{ padding: spacing.sm }}
        >
          Sign out on all devices
        </button>
      </div>
    </main>
  );
}
