"use client";

import { copy, fill, plural } from "@fleettrust/copy";
import { EMPLOYMENT_TYPES, JOB_ROLES, jobWarnings } from "@fleettrust/types";
import Link from "next/link";
import { type SubmitEvent, use, useState } from "react";

import { Button } from "@/components/button";
import { SelectField, TextArea, TextField } from "@/components/field";
import { Badge, EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { errorMessage } from "@fleettrust/sdk";
import { formatDate, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.org.jobs;

type Role = (typeof JOB_ROLES)[number];
type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** Employer job listings: draft, publish (fee wording goes to moderation first), close. */
export default function EmployerJobsPage(props: PageProps<"/app/o/[orgId]/jobs">) {
  const { orgId } = use(props.params);
  const { api } = useSession();
  const jobs = useLoad(() => api.employerJobs(orgId), `jobs-${orgId}`);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState<Role>("driver");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("full_time");
  const [locality, setLocality] = useState("");
  const [countryCode, setCountryCode] = useState("ZA");
  const [closesOn, setClosesOn] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const warnings = jobWarnings(`${title} ${description}`);

  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      setMessage({ ok: true, text: done });
      jobs.reload();
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  };

  function create(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim().length < 5 || description.trim().length < 50) {
      setMessage({
        ok: false,
        text: t.tooShort,
      });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closesOn)) {
      setMessage({ ok: false, text: t.closingDateMissing });
      return;
    }
    void act(async () => {
      await api.createJob(orgId, {
        title: title.trim(),
        description: description.trim(),
        role,
        employmentType,
        locality: locality.trim(),
        countryCode: countryCode.trim().toUpperCase(),
        closesOn,
      });
      setTitle("");
      setDescription("");
    }, t.draftSaved);
  }

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      {jobs.status === "loading" ? <Loading /> : null}
      {jobs.status === "error" ? <ErrorNotice error={jobs.error} onRetry={jobs.reload} /> : null}
      {jobs.status === "ready" ? (
        jobs.data.length === 0 ? (
          <EmptyState title={t.empty} />
        ) : (
          <ul className="list-plain">
            {jobs.data.map((job) => (
              <li key={job.id} className="card stack" style={{ gap: 8 }}>
                <p style={{ margin: 0 }}>
                  <strong>{job.title}</strong> <Badge>{titleCase(job.status)}</Badge>
                </p>
                <p className="small muted" style={{ margin: 0 }}>
                  {plural(job.applications.total, t.summary, {
                    locality: job.locality,
                    date: formatDate(job.closesOn),
                    submitted: job.applications.submitted,
                  })}
                </p>
                {job.moderationNote ? (
                  <p className="small" style={{ margin: 0 }}>
                    {fill(t.moderator, { note: job.moderationNote })}
                  </p>
                ) : null}
                <div className="cluster">
                  {job.status === "draft" || job.status === "rejected" ? (
                    <Button
                      onClick={() => void act(() => api.publishJob(orgId, job.id), t.submitted)}
                    >
                      {fill(t.publish, { title: job.title })}
                    </Button>
                  ) : null}
                  {job.status === "published" ? (
                    <>
                      <Link href={`/jobs/${job.id}`}>{t.viewListing}</Link>
                      <Button
                        variant="ghost"
                        onClick={() => void act(() => api.closeJob(orgId, job.id), t.closed)}
                      >
                        {fill(t.close, { title: job.title })}
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
      <Card title={t.newJob}>
        <form className="stack" onSubmit={create} noValidate>
          <TextField
            label={t.jobTitle}
            required
            maxLength={120}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
          <TextArea
            label={t.descriptionLabel}
            hint={t.descriptionHint}
            required
            maxLength={5000}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
          {warnings.length > 0 ? (
            <Notice tone="caution">
              <p>{t.feeWarning}</p>
            </Notice>
          ) : null}
          <div className="grid">
            <SelectField
              label={t.role}
              required
              value={role}
              onChange={(event) => {
                setRole(JOB_ROLES.find((r) => r === event.target.value) ?? "driver");
              }}
              options={JOB_ROLES.map((value) => ({ value, label: titleCase(value) }))}
            />
            <SelectField
              label={t.type}
              required
              value={employmentType}
              onChange={(event) => {
                setEmploymentType(
                  EMPLOYMENT_TYPES.find((type) => type === event.target.value) ?? "full_time",
                );
              }}
              options={EMPLOYMENT_TYPES.map((value) => ({ value, label: titleCase(value) }))}
            />
            <TextField
              label={t.town}
              required
              maxLength={80}
              value={locality}
              onChange={(event) => {
                setLocality(event.target.value);
              }}
            />
            <TextField
              label={t.countryCode}
              required
              maxLength={2}
              value={countryCode}
              onChange={(event) => {
                setCountryCode(event.target.value);
              }}
            />
            <TextField
              label={t.closingDate}
              type="date"
              required
              value={closesOn}
              onChange={(event) => {
                setClosesOn(event.target.value);
              }}
            />
          </div>
          <div>
            <Button type="submit">{t.saveDraft}</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
