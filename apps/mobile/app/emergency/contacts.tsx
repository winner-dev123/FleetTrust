import { errorMessage } from "@fleettrust/sdk";
import { type PersonDto, titleCase } from "@fleettrust/types";
import { useState } from "react";
import { View } from "react-native";

import { ErrorNotice, SignInPrompt } from "../../src/components/feedback";
import { PushPrompt } from "../../src/components/push-prompt";
import {
  Body,
  Button,
  Card,
  EmptyState,
  Heading,
  Loading,
  Notice,
  Screen,
  TextField,
} from "../../src/components/ui";
import { useLoad } from "../../src/lib/use-load";
import { useSession } from "../../src/state/session";

/** Trusted contacts: people who receive your alerts, and people who trust you. */
function Contacts() {
  const { api } = useSession();
  const contacts = useLoad(() => api.trustedContacts(), "trusted-contacts");
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PersonDto[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      setMessage({ ok: true, text: done });
      contacts.reload();
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  };

  async function search() {
    if (query.trim().length < 2) return;
    try {
      setPeople(await api.searchPeople(query.trim(), 10));
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  if (contacts.status === "loading") return <Loading />;
  if (contacts.status === "error")
    return <ErrorNotice error={contacts.error} onRetry={contacts.reload} />;
  const mine = contacts.data.filter((c) => c.role === "my_contact");
  const forOthers = contacts.data.filter((c) => c.role === "contact_for");

  return (
    <>
      <Body>
        People you trust to receive your alerts. They must accept before they can be alerted.
        Primary contacts are alerted first; backups if nobody responds in time.
      </Body>
      <PushPrompt reason="Turn on notifications so you see alerts from people who trust you." />
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live>
          <Body>{message.text}</Body>
        </Notice>
      ) : null}
      <Card title="Your trusted contacts">
        {mine.length === 0 ? <EmptyState title="No trusted contacts yet" /> : null}
        {mine.map((contact) => (
          <View key={contact.id} style={{ gap: 4 }}>
            <Body>
              {contact.person.displayName} ·{" "}
              {contact.status === "active" && contact.muted
                ? "Paused alerts"
                : titleCase(contact.status)}{" "}
              · {titleCase(contact.priority)}
            </Body>
            <Button
              label={`Remove ${contact.person.displayName}`}
              variant="ghost"
              onPress={() =>
                void act(() => api.removeTrustedContact(contact.id), "Contact removed.")
              }
            />
          </View>
        ))}
        <TextField
          label="Add a contact"
          hint="Search by display name"
          value={query}
          maxLength={50}
          onChangeText={setQuery}
        />
        <Button label="Search people" variant="secondary" onPress={() => void search()} />
        {people?.length === 0 ? <Body muted>Nobody found with that name.</Body> : null}
        {people?.map((person) => (
          <Button
            key={person.userId}
            label={`Invite ${person.displayName}`}
            variant="secondary"
            onPress={() =>
              void act(
                () => api.inviteTrustedContact(person.userId),
                `Invitation sent to ${person.displayName}.`,
              )
            }
          />
        ))}
      </Card>
      {forOthers.length > 0 ? (
        <Card title="You're a trusted contact for">
          {forOthers.map((contact) => (
            <View key={contact.id} style={{ gap: 4 }}>
              <Body>
                {contact.person.displayName} · {titleCase(contact.status)}
              </Body>
              {contact.status === "pending" ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button
                    label="Accept"
                    onPress={() =>
                      void act(() => api.respondToTrustedContact(contact.id, true), "You accepted.")
                    }
                  />
                  <Button
                    label="Decline"
                    variant="ghost"
                    onPress={() =>
                      void act(
                        () => api.respondToTrustedContact(contact.id, false),
                        "You declined.",
                      )
                    }
                  />
                </View>
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}

export default function TrustedContactsScreen() {
  const { status } = useSession();
  return (
    <Screen>
      <Heading>Trusted contacts</Heading>
      {status === "loading" ? <Loading /> : null}
      {status === "signed-out" ? (
        <SignInPrompt
          title="Sign in to manage contacts"
          reason="Trusted contacts belong to your account."
        />
      ) : null}
      {status === "signed-in" ? <Contacts /> : null}
    </Screen>
  );
}
