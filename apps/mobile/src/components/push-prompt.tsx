import { copy, fill } from "@fleettrust/copy";
import { useEffect, useState } from "react";

import { pushAdvice } from "../lib/permissions";
import { enablePush } from "../lib/push";
import type { PushPermission } from "../platform/types";
import { useSession } from "../state/session";
import { Body, Button, Notice } from "./ui";

/**
 * Offers notifications at the moment they're useful (after a request is sent, when managing
 * trusted contacts, or in Account) instead of a prompt at launch. Shows nothing once
 * notifications are on, unless `always` (the Account screen) asks for the status line.
 */
export function PushPrompt({ reason, always = false }: { reason?: string; always?: boolean }) {
  const { platform, api } = useSession();
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void platform.push
      .permission()
      .catch(() => "denied" as const)
      .then((state) => {
        if (active) setPermission(state);
      });
    return () => {
      active = false;
    };
  }, [platform]);

  if (permission === null || (permission === "granted" && !always)) return null;
  const advice = pushAdvice(permission);

  async function act() {
    if (advice.action === "settings") {
      await platform.device.openSettings();
      return;
    }
    setBusy(true);
    const result = await enablePush(platform, api).catch(() => null);
    setBusy(false);
    if (!result) return;
    setPermission(result.permission);
    if (result.registration === "failed") {
      setNote(copy.push.registrationFailed);
    }
  }

  return (
    <Notice title={copy.push.title}>
      <Body>
        {reason && permission !== "granted"
          ? fill(copy.push.withReason, { reason, advice: advice.message })
          : advice.message}
      </Body>
      {note ? (
        <Body small tone="caution">
          {note}
        </Body>
      ) : null}
      {advice.actionLabel ? (
        <Button
          label={advice.actionLabel}
          variant="secondary"
          busy={busy}
          onPress={() => void act()}
        />
      ) : null}
    </Notice>
  );
}
