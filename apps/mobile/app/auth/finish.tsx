import { copy } from "@fleettrust/copy";
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
      <Heading>{copy.signIn.finishing}</Heading>
      {state === "working" ? <Loading label={copy.signIn.finishingLabel} /> : null}
      {state === "need-email" ? (
        <>
          <Body>{copy.signIn.otherDevice}</Body>
          <TextField
            label={copy.signIn.emailLabel}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            error={error}
          />
          <Button
            label={copy.signIn.finish}
            onPress={() => {
              if (!isEmail(email.trim())) {
                setError(copy.signIn.finishEmailInvalid);
                return;
              }
              setState("working");
              void finish(email);
            }}
          />
        </>
      ) : null}
      {state === "invalid-link" || state === "failed" ? (
        <Notice tone="danger" title={copy.signIn.linkFailedTitle} live>
          <Body>{copy.signIn.linkFailedBody}</Body>
          <Button
            label={copy.signIn.newLink}
            onPress={() => {
              router.replace("/sign-in");
            }}
          />
        </Notice>
      ) : null}
    </Screen>
  );
}
