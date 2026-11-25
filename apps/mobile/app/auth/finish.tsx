import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { Body, Button, Heading, Loading, Notice, Screen, TextField } from "../../src/components/ui";
import { finishEmailSignIn, type FinishResult, isEmail } from "../../src/lib/sign-in";
import { useSession } from "../../src/state/session";

type State = "working" | "need-email" | "invalid-link" | "failed";

// An email link works once: share one attempt per link even if the effect runs twice.
const attempts = new Map<string, Promise<FinishResult>>();

/** Where an email sign-in link lands (via universal / app links). */
export default function FinishSignInScreen() {
  const { link } = useLocalSearchParams<{ link?: string }>();
  const { platform } = useSession();
  const router = useRouter();
  const [state, setState] = useState<State>(typeof link === "string" ? "working" : "invalid-link");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function finish(address?: string) {
    if (typeof link !== "string") return;
    try {
      const result = await finishEmailSignIn(platform, link, address);
      if (result.status === "signed-in") router.replace(result.returnPath);
      else setState(result.status);
    } catch {
      setState("failed");
    }
  }

  useEffect(() => {
    if (typeof link !== "string") return;
    let active = true;
    const attempt = attempts.get(link) ?? finishEmailSignIn(platform, link);
    attempts.set(link, attempt);
    void attempt.then(
      (result) => {
        if (!active) return;
        if (result.status === "signed-in") router.replace(result.returnPath);
        else setState(result.status);
      },
      () => {
        if (active) setState("failed");
      },
    );
    return () => {
      active = false;
    };
  }, [link, platform, router]);

  return (
    <Screen>
      <Heading>Signing in</Heading>
      {state === "working" ? <Loading label="Signing you in…" /> : null}
      {state === "need-email" ? (
        <>
          <Body>
            This link was requested on another device. Confirm your email address to finish.
          </Body>
          <TextField
            label="Email address"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            error={error}
          />
          <Button
            label="Finish signing in"
            onPress={() => {
              if (!isEmail(email.trim())) {
                setError("Enter the address the link was sent to.");
                return;
              }
              setState("working");
              void finish(email);
            }}
          />
        </>
      ) : null}
      {state === "invalid-link" || state === "failed" ? (
        <Notice tone="danger" title="This link didn't work" live>
          <Body>It may have expired or been used already. Ask for a new one.</Body>
          <Button
            label="Get a new link"
            onPress={() => {
              router.replace("/sign-in");
            }}
          />
        </Notice>
      ) : null}
    </Screen>
  );
}
