import { errorMessage, isOffline } from "@fleettrust/sdk";
import { usePathname, useRouter } from "expo-router";
import { Body, Button, Notice } from "./ui";

/** Explains a failed load in one sentence, with a retry. Offline gets its own wording. */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const offline = isOffline(error);
  return (
    <Notice
      tone={offline ? "caution" : "danger"}
      title={offline ? "You're offline" : "Something went wrong"}
      live
    >
      <Body>
        {offline
          ? "We couldn't reach FleetTrust. Check your connection; anything you typed is kept."
          : errorMessage(error)}
      </Body>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    </Notice>
  );
}

/** Shown in place of a signed-in screen; returns here after sign-in. */
export function SignInPrompt({ title, reason }: { title: string; reason: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Notice title={title}>
      <Body>{reason}</Body>
      <Button
        label="Sign in"
        onPress={() => {
          router.push({ pathname: "/sign-in", params: { returnTo: pathname } });
        }}
      />
    </Notice>
  );
}
