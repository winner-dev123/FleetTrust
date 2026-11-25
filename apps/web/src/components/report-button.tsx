"use client";

import { REPORT_REASONS, type ReportTargetType } from "@fleettrust/types";
import Link from "next/link";
import { type SubmitEvent, useState } from "react";

import { errorMessage } from "@fleettrust/sdk";
import { titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";

import { Button } from "./button";
import { SelectField, TextArea } from "./field";
import { Notice } from "./feedback";

/** "Report" disclosure: reason and optional details, sent to trust and safety moderators. */
export function ReportButton({
  targetType,
  targetId,
  what,
}: {
  targetType: ReportTargetType;
  targetId: string;
  /** "article", "job listing", "comment": used in the button text. */
  what: string;
}) {
  const { api, status } = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]>("spam");
  const [details, setDetails] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (status !== "signed-in") {
    return (
      <p className="small muted">
        <Link href="/sign-in">Sign in</Link> to report this {what}.
      </p>
    );
  }
  if (result?.ok) {
    return (
      <Notice tone="success" live="polite">
        <p>{result.message}</p>
      </Notice>
    );
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.report({
        targetType,
        targetId,
        reason,
        details: details.trim() === "" ? null : details.trim(),
      });
      setResult({ ok: true, message: "Thanks. A moderator will review your report." });
    } catch (error) {
      setResult({ ok: false, message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return open ? (
    <form className="card stack" onSubmit={(event) => void submit(event)}>
      <SelectField
        label={`Why are you reporting this ${what}?`}
        required
        value={reason}
        onChange={(event) => {
          setReason(
            REPORT_REASONS.find((value) => value === event.target.value) ?? REPORT_REASONS[0],
          );
        }}
        options={REPORT_REASONS.map((value) => ({ value, label: titleCase(value) }))}
      />
      <TextArea
        label="Details"
        maxLength={1000}
        value={details}
        onChange={(event) => {
          setDetails(event.target.value);
        }}
      />
      {result && !result.ok ? (
        <Notice tone="danger" live="assertive">
          <p>{result.message}</p>
        </Notice>
      ) : null}
      <div className="cluster">
        <Button type="submit" busy={busy}>
          Send report
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  ) : (
    <Button
      variant="ghost"
      onClick={() => {
        setOpen(true);
      }}
    >
      Report this {what}
    </Button>
  );
}
