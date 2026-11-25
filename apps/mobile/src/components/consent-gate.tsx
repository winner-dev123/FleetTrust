import { errorMessage } from "@fleettrust/sdk";
import { CONSENT_LABELS, type ConsentStateDto } from "@fleettrust/types";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { mobileEnv } from "../env";
import { useSession } from "../state/session";
import { useTheme } from "./theme";
import { Body, Button, Heading, Notice, Toggle } from "./ui";

/**
 * Asks a signed-in person to accept the terms of service and privacy notice (first sign-in,
 * and again when their version changes), before anything else (Prompt 27). The choice is
 * recorded with its version. If the check fails, the app isn't blocked: the API stays the
 * boundary.
 */
export function ConsentGate() {
  const { api, platform, status, user } = useSession();
  const theme = useTheme();
  const [missing, setMissing] = useState<ConsentStateDto[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const uid = status === "signed-in" ? (user?.uid ?? null) : null;
  useEffect(() => {
    if (uid === null) return;
    let active = true;
    api.consents().then(
      (states) => {
        if (active) setMissing(states.filter((c) => c.needsAnswer));
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api, uid]);

  if (uid === null || missing.length === 0) return null;

  async function accept() {
    if (!agreed) {
      setError("Turn on the agreement to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let latest: ConsentStateDto[] = [];
      for (const consent of missing) {
        latest = await api.recordConsent({
          purpose: consent.purpose,
          version: consent.currentVersion,
          granted: true,
        });
      }
      setMissing(latest.filter((c) => c.needsAnswer));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
        backgroundColor: theme.color.background,
      }}
      testID="consent-gate"
    >
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg, paddingTop: 64 }}
      >
        <Heading>
          {missing.some((c) => c.version !== null) ? "Our terms have changed" : "Before you start"}
        </Heading>
        <Body>Please read and accept these to use FleetTrust:</Body>
        {missing.map((c) => (
          <Button
            key={c.purpose}
            label={`Read the ${CONSENT_LABELS[c.purpose].toLowerCase()} (version ${c.currentVersion})`}
            variant="ghost"
            onPress={() =>
              void platform.device.openExternal(
                `${mobileEnv.webUrl}${c.purpose === "terms" ? "/legal/terms" : "/legal/privacy"}`,
              )
            }
          />
        ))}
        <Toggle
          label="I agree to the terms of service and have read the privacy notice"
          value={agreed}
          onChange={setAgreed}
        />
        {error ? (
          <Notice tone="danger" live>
            <Body>{error}</Body>
          </Notice>
        ) : null}
        <Button label="Continue" busy={busy} onPress={() => void accept()} />
      </ScrollView>
    </View>
  );
}
