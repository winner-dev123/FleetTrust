import { copy, fill } from "@fleettrust/copy";
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
    { key: "pushMessages", label: copy.account.pushMessages },
    { key: "pushRequests", label: copy.account.pushRequests },
    { key: "pushCommunity", label: copy.account.pushCommunity },
    {
      key: "pushPreviews",
      label: copy.account.pushPreviews,
      hint: copy.account.pushPreviewsHint,
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
    <Card title={copy.account.locationTitle}>
      <Body>
        {permission === "granted"
          ? copy.account.locationAllowed
          : locationAdvice(permission).message}
      </Body>
      <Button
        label={copy.account.locationSettings}
        variant="ghost"
        onPress={() => void platform.device.openSettings()}
      />
    </Card>
  );
}

/**
 * Account deletion in the app (App Store and Play policy; Prompt 27). The person types DELETE;
 * the API also needs a recent sign-in. A copy of the data is downloaded on the website.
 */
function DeleteAccount() {
  const { api, platform, signOut } = useSession();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount("account.delete");
      await signOut().catch(() => undefined);
      router.replace("/");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={copy.account.dataTitle}>
      <Body>{copy.account.dataBody}</Body>
      <Button
        label={copy.account.downloadData}
        variant="ghost"
        onPress={() => void platform.device.openExternal(`${mobileEnv.webUrl}/app/account`)}
      />
      <Heading level={2}>{copy.account.deleteTitle}</Heading>
      <Body small muted>
        {copy.account.deleteBody}
      </Body>
      <TextField
        label={fill(copy.account.deleteConfirmLabel, { word: copy.account.deleteConfirmWord })}
        autoCapitalize="characters"
        value={typed}
        onChangeText={setTyped}
      />
      {error ? <Body tone="danger">{error}</Body> : null}
      <Button
        label={copy.account.deleteButton}
        variant="danger"
        busy={busy}
        disabled={typed.trim() !== copy.account.deleteConfirmWord}
        onPress={() => void remove()}
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
      <Body muted>
        {fill(copy.account.signedInAs, {
          email: me.email ?? user?.email ?? copy.account.signedInAsFallback,
        })}
      </Body>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live>
          <Body>{message.text}</Body>
        </Notice>
      ) : null}
      <Card title={copy.account.profileTitle}>
        {!me.profileComplete ? <Body tone="caution">{copy.account.addDisplayName}</Body> : null}
        <TextField
          label={copy.account.displayName}
          maxLength={50}
          value={displayName}
          onChangeText={setName}
        />
        <Button
          label={copy.account.saveName}
          variant="secondary"
          busy={busy === "name"}
          onPress={() =>
            void run(
              "name",
              async () => {
                const updated = await api.updateMe({ displayName: displayName.trim() || null });
                data.setData({ me: updated, preferences });
              },
              copy.account.nameSaved,
            )
          }
        />
      </Card>
      <PushPrompt always />
      <Card title={copy.account.notificationsTitle}>
        <Body small muted>
          {copy.account.notificationsKept}
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
                copy.account.saved,
              )
            }
          />
        ))}
        <Button
          label={copy.account.openNotifications}
          variant="ghost"
          onPress={() => {
            router.push("/notifications");
          }}
        />
      </Card>
      <LocationStatus />
      <Card title={copy.account.websiteTitle}>
        <Body>{copy.account.websiteBody}</Body>
        <Button
          label={copy.account.openWebsite}
          variant="ghost"
          onPress={() => void platform.device.openExternal(`${mobileEnv.webUrl}/app/account`)}
        />
      </Card>
      <DeleteAccount />
      <Card title={copy.account.signOutTitle}>
        <Body small muted>
          {copy.account.signOutBody}
        </Body>
        <Button
          label={copy.account.signOut}
          variant="secondary"
          busy={busy === "signout"}
          onPress={() => void run("signout", signOut, copy.account.signedOut)}
        />
      </Card>
    </>
  );
}

export default function AccountScreen() {
  const { status } = useSession();
  return (
    <Screen>
      <Heading>{copy.account.title}</Heading>
      {status === "loading" ? <Loading /> : null}
      {status === "signed-out" ? (
        <SignInPrompt title={copy.account.signInTitle} reason={copy.account.signInReason} />
      ) : null}
      {status === "signed-in" ? <SignedInAccount /> : null}
    </Screen>
  );
}
