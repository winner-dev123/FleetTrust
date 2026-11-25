import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import { Body, Button, Heading, Notice, Screen, TextField } from "../src/components/ui";
import { mobileEnv } from "../src/env";
import { isEmail, startEmailSignIn } from "../src/lib/sign-in";
import { useOnline } from "../src/state/network";
import { useSession } from "../src/state/session";

/**
 * Email-link sign-in (no passwords). The link opens this app on the phone. Google and Apple
 * sign-in come later and must ship together on iOS (KC-01).
 */
export default function SignInScreen() {
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const { platform, status } = useSession();
  const online = useOnline();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "signed-in") {
    return (
      <Screen>
        <Heading>You&apos;re signed in</Heading>
        <Button
          label="Continue"
          onPress={() => {
            router.replace("/");
          }}
        />
      </Screen>
    );
  }

  async function send() {
    if (!isEmail(email.trim())) {
      setError("Enter an email address like name@example.com.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await startEmailSignIn(platform, {
        email,
        returnPath: typeof params.returnTo === "string" ? params.returnTo : null,
        webUrl: mobileEnv.webUrl,
        linkDomain: mobileEnv.linkDomain,
      });
      setSentTo(email.trim().toLowerCase());
    } catch {
      setError(
        online
          ? "We couldn't send the link. Check the address and try again."
          : "You're offline. Connect and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Heading>Sign in</Heading>
      {sentTo ? (
        <Notice tone="success" title="Check your email" live>
          <Body>
            We sent a sign-in link to {sentTo}. Open it on this phone to sign in. The link works
            once and expires soon.
          </Body>
        </Notice>
      ) : (
        <>
          <Body>
            We&apos;ll email you a link. No password needed. New here? The same link creates your
            account.
          </Body>
          <TextField
            label="Email address"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            maxLength={254}
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={() => void send()}
            error={error}
          />
          <Button
            label="Email me a link"
            busy={busy}
            disabled={!online}
            onPress={() => void send()}
          />
          <Body small muted>
            By continuing you confirm you are 18 or older.
          </Body>
        </>
      )}
    </Screen>
  );
}
