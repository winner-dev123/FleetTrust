import { copy, fill } from "@fleettrust/copy";
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
        <Heading>{copy.signIn.alreadySignedIn}</Heading>
        <Button
          label={copy.signIn.continue}
          onPress={() => {
            router.replace("/");
          }}
        />
      </Screen>
    );
  }

  async function send() {
    if (!isEmail(email.trim())) {
      setError(copy.signIn.emailInvalid);
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
      setError(online ? copy.signIn.sendFailed : copy.signIn.offline);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Heading>{copy.signIn.title}</Heading>
      {sentTo ? (
        <Notice tone="success" title={copy.signIn.sentTitle} live>
          <Body>{fill(copy.signIn.sentBody, { email: sentTo })}</Body>
        </Notice>
      ) : (
        <>
          <Body>{copy.signIn.intro}</Body>
          <TextField
            label={copy.signIn.emailLabel}
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
            label={copy.signIn.sendLink}
            busy={busy}
            disabled={!online}
            onPress={() => void send()}
          />
          <Body small muted>
            {copy.signIn.ageConfirmation}
          </Body>
        </>
      )}
    </Screen>
  );
}
