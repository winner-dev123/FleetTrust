"use client";

import { EMPLOYMENT_TYPES, JOB_ROLES, jobWarnings } from "@fleettrust/types";
import Link from "next/link";
import { type SubmitEvent, use, useState } from "react";

import { Button } from "@/components/button";
import { SelectField, TextArea, TextField } from "@/components/field";
import { Badge, EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { errorMessage } from "@/lib/errors";
import { formatDate, titleCase } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

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
        text: "Title: at least 5 characters. Description: at least 50 characters.",
      });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closesOn)) {
      setMessage({ ok: false, text: "Choose a closing date." });
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
    }, "Draft saved. Publish it when ready.");
  }

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Post jobs for drivers, mechanics and fleet staff. Free for applicants."
      />
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      {jobs.status === "loading" ? <Loading /> : null}
      {jobs.status === "error" ? <ErrorNotice error={jobs.error} onRetry={jobs.reload} /> : null}
      {jobs.status === "ready" ? (
        jobs.data.length === 0 ? (
          <EmptyState title="No jobs yet" />
        ) : (
          <ul className="list-plain">
            {jobs.data.map((job) => (
              <li key={job.id} className="card stack" style={{ gap: 8 }}>
                <p style={{ margin: 0 }}>
                  <strong>{job.title}</strong> <Badge>{titleCase(job.status)}</Badge>
                </p>
                <p className="small muted" style={{ margin: 0 }}>
                  {job.locality} · closes {formatDate(job.closesOn)} ·{" "}
                  {String(job.applications.total)} applications (
                  {String(job.applications.submitted)} new)
                </p>
                {job.moderationNote ? (
                  <p className="small" style={{ margin: 0 }}>
                    Moderator: {job.moderationNote}
                  </p>
                ) : null}
                <div className="cluster">
                  {job.status === "draft" || job.status === "rejected" ? (
                    <Button
                      onClick={() => void act(() => api.publishJob(orgId, job.id), "Submitted.")}
                    >
                      Publish {job.title}
                    </Button>
                  ) : null}
                  {job.status === "published" ? (
                    <>
                      <Link href={`/jobs/${job.id}`}>View listing</Link>
                      <Button
                        variant="ghost"
                        onClick={() => void act(() => api.closeJob(orgId, job.id), "Job closed.")}
                      >
                        Close {job.title}
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
      <Card title="New job">
        <form className="stack" onSubmit={create} noValidate>
          <TextField
            label="Job title"
            required
            maxLength={120}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
          <TextArea
            label="Description"
            hint="Duties, requirements, hours and how you'll contact applicants (at least 50 characters)."
            required
            maxLength={5000}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
          {warnings.length > 0 ? (
            <Notice tone="caution">
              <p>
                This listing mentions fees or deposits. Listings that ask applicants to pay are
                checked by a moderator before they appear, and may be refused.
              </p>
            </Notice>
          ) : null}
          <div className="grid">
            <SelectField
              label="Role"
              required
              value={role}
              onChange={(event) => {
                setRole(JOB_ROLES.find((r) => r === event.target.value) ?? "driver");
              }}
              options={JOB_ROLES.map((value) => ({ value, label: titleCase(value) }))}
            />
            <SelectField
              label="Type"
              required
              value={employmentType}
              onChange={(event) => {
                setEmploymentType(
                  EMPLOYMENT_TYPES.find((t) => t === event.target.value) ?? "full_time",
                );
              }}
              options={EMPLOYMENT_TYPES.map((value) => ({ value, label: titleCase(value) }))}
            />
            <TextField
              label="Town"
              required
              maxLength={80}
              value={locality}
              onChange={(event) => {
                setLocality(event.target.value);
              }}
            />
            <TextField
              label="Country code"
              required
              maxLength={2}
              value={countryCode}
              onChange={(event) => {
                setCountryCode(event.target.value);
              }}
            />
            <TextField
              label="Closing date"
              type="date"
              required
              value={closesOn}
              onChange={(event) => {
                setClosesOn(event.target.value);
              }}
            />
          </div>
          <div>
            <Button type="submit">Save draft</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
