import { copy, fill } from "@fleettrust/copy";
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
      <Body>{copy.trustedContacts.intro}</Body>
      <PushPrompt reason={copy.trustedContacts.pushReason} />
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live>
          <Body>{message.text}</Body>
        </Notice>
      ) : null}
      <Card title={copy.trustedContacts.mineTitle}>
        {mine.length === 0 ? <EmptyState title={copy.trustedContacts.empty} /> : null}
        {mine.map((contact) => (
          <View key={contact.id} style={{ gap: 4 }}>
            <Body>
              {contact.person.displayName} ·{" "}
              {contact.status === "active" && contact.muted
                ? copy.trustedContacts.pausedAlerts
                : titleCase(contact.status)}{" "}
              · {titleCase(contact.priority)}
            </Body>
            <Button
              label={fill(copy.trustedContacts.remove, { name: contact.person.displayName })}
              variant="ghost"
              onPress={() =>
                void act(() => api.removeTrustedContact(contact.id), copy.trustedContacts.removed)
              }
            />
          </View>
        ))}
        <TextField
          label={copy.trustedContacts.addLabel}
          hint={copy.trustedContacts.addHint}
          value={query}
          maxLength={50}
          onChangeText={setQuery}
        />
        <Button
          label={copy.trustedContacts.searchPeople}
          variant="secondary"
          onPress={() => void search()}
        />
        {people?.length === 0 ? <Body muted>{copy.trustedContacts.nobodyFound}</Body> : null}
        {people?.map((person) => (
          <Button
            key={person.userId}
            label={fill(copy.trustedContacts.invite, { name: person.displayName })}
            variant="secondary"
            onPress={() =>
              void act(
                () => api.inviteTrustedContact(person.userId),
                fill(copy.trustedContacts.invited, { name: person.displayName }),
              )
            }
          />
        ))}
      </Card>
      {forOthers.length > 0 ? (
        <Card title={copy.trustedContacts.forOthersTitle}>
          {forOthers.map((contact) => (
            <View key={contact.id} style={{ gap: 4 }}>
              <Body>
                {contact.person.displayName} · {titleCase(contact.status)}
              </Body>
              {contact.status === "pending" ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button
                    label={copy.trustedContacts.accept}
                    onPress={() =>
                      void act(
                        () => api.respondToTrustedContact(contact.id, true),
                        copy.trustedContacts.accepted,
                      )
                    }
                  />
                  <Button
                    label={copy.trustedContacts.decline}
                    variant="ghost"
                    onPress={() =>
                      void act(
                        () => api.respondToTrustedContact(contact.id, false),
                        copy.trustedContacts.declined,
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
      <Heading>{copy.trustedContacts.title}</Heading>
      {status === "loading" ? <Loading /> : null}
      {status === "signed-out" ? (
        <SignInPrompt
          title={copy.trustedContacts.signInTitle}
          reason={copy.trustedContacts.signInReason}
        />
      ) : null}
      {status === "signed-in" ? <Contacts /> : null}
    </Screen>
  );
}
