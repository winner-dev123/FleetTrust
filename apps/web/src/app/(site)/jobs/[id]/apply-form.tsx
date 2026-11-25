"use client";

import { copy } from "@fleettrust/copy";
import Link from "next/link";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/button";
import { TextArea, TextField } from "@/components/field";
import { Notice } from "@/components/feedback";
import { errorMessage } from "@fleettrust/sdk";
import { useSession } from "@/lib/session";

/** Apply with a message and the contact details you choose to share with this employer. */
export function ApplyForm({ jobId }: { jobId: string }) {
  const { api, status } = useSession();
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (status !== "signed-in") {
    return (
      <section className="card card--muted">
        <h2 className="card__title">{copy.web.apply.title}</h2>
        <p style={{ margin: 0 }}>
          <Link href="/sign-in">{copy.web.apply.signIn}</Link> {copy.web.apply.signInToApply}
        </p>
      </section>
    );
  }
  if (done) {
    return (
      <Notice tone="success" live="polite" title={copy.web.apply.sentTitle}>
        <p>
          {copy.web.apply.sentBody} <Link href="/app">{copy.web.apply.sentLink}</Link>.
        </p>
      </Notice>
    );
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (message.trim().length < 20) {
      setError(copy.web.apply.messageTooShort);
      return;
    }
    if (phone.trim() === "" && email.trim() === "") {
      setError(copy.web.apply.needContact);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.applyForJob(jobId, {
        message: message.trim(),
        phone: phone.trim() === "" ? null : phone.trim(),
        email: email.trim() === "" ? null : email.trim(),
      });
      setDone(true);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={(event) => void submit(event)} noValidate>
      <h2 className="card__title">{copy.web.apply.title}</h2>
      <TextArea
        label={copy.web.apply.messageLabel}
        hint={copy.web.apply.messageHint}
        required
        maxLength={3000}
        value={message}
        onChange={(event) => {
          setMessage(event.target.value);
        }}
      />
      <TextField
        label={copy.web.apply.phone}
        type="tel"
        autoComplete="tel"
        value={phone}
        onChange={(event) => {
          setPhone(event.target.value);
        }}
      />
      <TextField
        label={copy.web.apply.email}
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
        }}
      />
      <p className="small muted">{copy.web.apply.privacy}</p>
      {error ? (
        <Notice tone="danger" live="assertive">
          <p>{error}</p>
        </Notice>
      ) : null}
      <div>
        <Button type="submit" busy={busy}>
          {copy.web.apply.send}
        </Button>
      </div>
    </form>
  );
}
