import { errorMessage } from "@fleettrust/sdk";
import type { MessagingPreferences } from "@fleettrust/types";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { ErrorNotice, SignInPrompt } from "../../src/components/feedback";
import { PushPrompt } from "../../src/components/push-prompt";
import {
  Body,
  Button,
  Card,
  Heading,
  Loading,
  Notice,
  Screen,
  TextField,
  Toggle,
} from "../../src/components/ui";
import { mobileEnv } from "../../src/env";
import { locationAdvice } from "../../src/lib/permissions";
import { useLoad } from "../../src/lib/use-load";
import type { LocationPermission } from "../../src/platform/types";
import { useSession } from "../../src/state/session";

const PUSH_SWITCHES: readonly { key: keyof MessagingPreferences; label: string; hint?: string }[] =
  [
    { key: "pushMessages", label: "New messages" },
    { key: "pushRequests", label: "Quotes and service requests" },
    { key: "pushCommunity", label: "Community (comments, friends, groups)" },
    {
      key: "pushPreviews",
      label: "Show message text on the lock screen",
      hint: "Off: notifications say “New message” only.",
    },
  ];

function LocationStatus() {
  const { platform } = useSession();
  const [permission, setPermission] = useState<LocationPermission | null>(null);
  useEffect(() => {
    let active = true;
    void platform.location.permission().then(
      (state) => {
        if (active) setPermission(state);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [platform]);
  if (permission === null) return null;
  return (
    <Card title="Location">
      <Body>
        {permission === "granted"
          ? "Allowed while you use the app. FleetTrust never tracks you in the background."
          : locationAdvice(permission).message}
      </Body>
      <Button
        label="Location settings"
        variant="ghost"
        onPress={() => void platform.device.openSettings()}
      />
    </Card>
  );
}

function SignedInAccount() {
  const { api, platform, user, signOut } = useSession();
  const router = useRouter();
  const data = useLoad(
    async () => {
      const [me, preferences] = await Promise.all([api.me(), api.messagingPreferences()]);
      return { me, preferences };
    },
    `account-${user?.uid ?? ""}`,
  );
  const [name, setName] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (data.status === "loading") return <Loading />;
  if (data.status === "error") return <ErrorNotice error={data.error} onRetry={data.reload} />;
  const { me, preferences } = data.data;
  const displayName = name ?? me.displayName ?? "";

  async function run(key: string, work: () => Promise<void>, done: string) {
    setBusy(key);
    setMessage(null);
    try {
      await work();
      setMessage({ ok: true, text: done });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Body muted>Signed in as {me.email ?? user?.email ?? "you"}</Body>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live>
          <Body>{message.text}</Body>
        </Notice>
      ) : null}
      <Card title="Profile">
        {!me.profileComplete ? (
          <Body tone="caution">Add a display name to request quotes and post.</Body>
        ) : null}
        <TextField label="Display name" maxLength={50} value={displayName} onChangeText={setName} />
        <Button
          label="Save name"
          variant="secondary"
          busy={busy === "name"}
          onPress={() =>
            void run(
              "name",
              async () => {
                const updated = await api.updateMe({ displayName: displayName.trim() || null });
                data.setData({ me: updated, preferences });
              },
              "Name saved.",
            )
          }
        />
      </Card>
      <PushPrompt always />
      <Card title="Which notifications">
        <Body small muted>
          Everything is also kept in your notifications list.
        </Body>
        {PUSH_SWITCHES.map((item) => (
          <Toggle
            key={item.key}
            label={item.label}
            hint={item.hint}
            value={preferences[item.key] === true}
            onChange={(value) =>
              void run(
                item.key,
                async () => {
                  const updated = await api.updateMessagingPreferences({ [item.key]: value });
                  data.setData({ me, preferences: updated });
                },
                "Saved.",
              )
            }
          />
        ))}
        <Button
          label="Open notifications"
          variant="ghost"
          onPress={() => {
            router.push("/notifications");
          }}
        />
      </Card>
      <LocationStatus />
      <Card title="Plans, appeals and businesses">
        <Body>Plan usage, appeals and business tools are on the FleetTrust website for now.</Body>
        <Button
          label="Open the website"
          variant="ghost"
          onPress={() => void platform.device.openExternal(`${mobileEnv.webUrl}/app/account`)}
        />
      </Card>
      <Card title="Sign out">
        <Body small muted>
          Signing out removes your drafts and unsent messages from this phone.
        </Body>
        <Button
          label="Sign out"
          variant="secondary"
          busy={busy === "signout"}
          onPress={() => void run("signout", signOut, "Signed out.")}
        />
      </Card>
    </>
  );
}

export default function AccountScreen() {
  const { status } = useSession();
  return (
    <Screen>
      <Heading>Account</Heading>
      {status === "loading" ? <Loading /> : null}
      {status === "signed-out" ? (
        <SignInPrompt
          title="Sign in or create an account"
          reason="It's free. Emergency alerts are never limited by a plan."
        />
      ) : null}
      {status === "signed-in" ? <SignedInAccount /> : null}
    </Screen>
  );
}
