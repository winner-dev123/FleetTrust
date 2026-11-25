import { CATEGORY_LABELS, formatDate, titleCase } from "@fleettrust/types";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";

import { ErrorNotice, SignInPrompt } from "../../src/components/feedback";
import {
  Badge,
  Body,
  Button,
  EmptyState,
  Heading,
  ListRow,
  Loading,
  Notice,
  Screen,
} from "../../src/components/ui";
import { REQUEST_DRAFT_ID, requestDraftSchema } from "../../src/lib/request-draft";
import { useLoad } from "../../src/lib/use-load";
import { useSession } from "../../src/state/session";

function RequestList({ uid }: { uid: string }) {
  const { api, drafts } = useSession();
  const router = useRouter();
  const requests = useLoad(() => api.serviceRequests(), `requests-${uid}`);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const { reload } = requests;

  useFocusEffect(
    useCallback(() => {
      reload();
      void drafts.load(uid, "request", REQUEST_DRAFT_ID, requestDraftSchema).then((draft) => {
        setDraftSavedAt(draft?.savedAt ?? null);
      });
    }, [drafts, reload, uid]),
  );

  return (
    <>
      <Button
        label="Request a quote"
        onPress={() => {
          router.push("/requests/new");
        }}
      />
      {draftSavedAt ? (
        <Notice title="Unsent request">
          <Body>
            You started a request on {formatDate(draftSavedAt)}. It&apos;s saved on this phone.
          </Body>
          <Button
            label="Continue draft"
            variant="secondary"
            onPress={() => {
              router.push("/requests/new");
            }}
          />
        </Notice>
      ) : null}
      {requests.status === "loading" ? <Loading /> : null}
      {requests.status === "error" ? <ErrorNotice error={requests.error} onRetry={reload} /> : null}
      {requests.status === "ready" && requests.data.length === 0 ? (
        <EmptyState title="No requests yet">
          Describe what you need and nearby providers can send you quotes.
        </EmptyState>
      ) : null}
      {requests.status === "ready"
        ? requests.data.map((request) => {
            const quotes = request.recipients.flatMap((r) =>
              r.quotes.filter((quote) => quote.status === "active"),
            ).length;
            return (
              <ListRow
                key={request.id}
                title={`${CATEGORY_LABELS[request.category]}: ${request.description.slice(0, 60)}${request.description.length > 60 ? "…" : ""}`}
                subtitle={`${String(quotes)} active ${quotes === 1 ? "quote" : "quotes"} · sent ${formatDate(request.createdAt)}`}
                detail={
                  <Badge
                    tone={request.status === "open" ? "caution" : "neutral"}
                    label={titleCase(request.status)}
                  />
                }
                onPress={() => {
                  router.push(`/requests/${request.id}`);
                }}
              />
            );
          })
        : null}
    </>
  );
}

/** Your service requests and their quotes. */
export default function RequestsScreen() {
  const { status, user } = useSession();
  return (
    <Screen>
      <Heading>Service requests</Heading>
      <Body muted>
        Ask providers for quotes. Quotes are indicative; you agree the final price and pay the
        provider directly.
      </Body>
      {status === "loading" ? <Loading /> : null}
      {status === "signed-out" ? (
        <SignInPrompt
          title="Sign in to request quotes"
          reason="Your requests and quotes appear here after you sign in."
        />
      ) : null}
      {status === "signed-in" && user ? <RequestList uid={user.uid} /> : null}
    </Screen>
  );
}
