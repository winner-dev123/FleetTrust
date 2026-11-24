"use client";

import Link from "next/link";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/button";
import { TextArea, TextField } from "@/components/field";
import { Notice } from "@/components/feedback";
import { errorMessage } from "@/lib/errors";
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
        <h2 className="card__title">Apply</h2>
        <p style={{ margin: 0 }}>
          <Link href="/sign-in">Sign in</Link> to apply. It&apos;s free.
        </p>
      </section>
    );
  }
  if (done) {
    return (
      <Notice tone="success" live="polite" title="Application sent">
        <p>
          The employer will contact you using the details you shared. Track it in{" "}
          <Link href="/app">your dashboard</Link>.
        </p>
      </Notice>
    );
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (message.trim().length < 20) {
      setError("Write at least 20 characters about yourself and your experience.");
      return;
    }
    if (phone.trim() === "" && email.trim() === "") {
      setError("Share a phone number or an email address so the employer can reach you.");
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
      <h2 className="card__title">Apply</h2>
      <TextArea
        label="Message to the employer"
        hint="Your experience, licence and when you can start (at least 20 characters)."
        required
        maxLength={3000}
        value={message}
        onChange={(event) => {
          setMessage(event.target.value);
        }}
      />
      <TextField
        label="Phone"
        type="tel"
        autoComplete="tel"
        value={phone}
        onChange={(event) => {
          setPhone(event.target.value);
        }}
      />
      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
        }}
      />
      <p className="small muted">Only this employer sees the details you share here.</p>
      {error ? (
        <Notice tone="danger" live="assertive">
          <p>{error}</p>
        </Notice>
      ) : null}
      <div>
        <Button type="submit" busy={busy}>
          Send application
        </Button>
      </div>
    </form>
  );
}
