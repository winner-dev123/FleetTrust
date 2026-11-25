import { copy, fill } from "@fleettrust/copy";
import { EMPLOYMENT_TYPES, JOB_ROLES } from "@fleettrust/types";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge, EmptyState, Notice } from "@/components/feedback";
import { formatDate, titleCase } from "@fleettrust/types";
import { publicApi } from "@/lib/public-api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: copy.web.jobs.title,
  description: copy.web.jobs.description,
};

const pick = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  values.find((candidate) => candidate === value);

/** Public job board. The filter form is a plain GET form, so it works without JavaScript. */
export default async function JobsPage(props: PageProps<"/jobs">) {
  const params = await props.searchParams;
  const q = typeof params["q"] === "string" ? params["q"].trim().slice(0, 100) : "";
  const role = pick(JOB_ROLES, params["role"]);
  const employmentType = pick(EMPLOYMENT_TYPES, params["employmentType"]);
  const verifiedOnly = params["verifiedOnly"] === "true";
  const offset = Math.min(1000, Math.max(0, Number(params["offset"]) || 0));
  const page = await publicApi().jobs({
    ...(q.length >= 2 ? { q } : {}),
    ...(role ? { role } : {}),
    ...(employmentType ? { employmentType } : {}),
    ...(verifiedOnly ? { verifiedOnly: "true" as const } : {}),
    offset,
  });

  const next = new URLSearchParams();
  if (q) next.set("q", q);
  if (role) next.set("role", role);
  if (employmentType) next.set("employmentType", employmentType);
  if (verifiedOnly) next.set("verifiedOnly", "true");
  if (page.nextOffset !== null) next.set("offset", String(page.nextOffset));

  return (
    <div className="container stack stack--lg">
      <header>
        <h1>{copy.web.jobs.title}</h1>
        <p className="muted">{copy.web.jobs.intro}</p>
      </header>
      <Notice tone="caution" title={copy.web.jobs.safeTitle}>
        <p>{copy.web.jobs.safeBody}</p>
      </Notice>
      <form className="card stack" role="search" action="/jobs" method="get">
        <div className="grid">
          <div className="field">
            <label className="field__label" htmlFor="job-q">
              {copy.web.jobs.keywords}
            </label>
            <input id="job-q" name="q" className="input" defaultValue={q} maxLength={100} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="job-role">
              {copy.web.jobs.role}
            </label>
            <select id="job-role" name="role" className="input" defaultValue={role ?? ""}>
              <option value="">{copy.web.jobs.anyRole}</option>
              {JOB_ROLES.map((value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="job-type">
              {copy.web.jobs.type}
            </label>
            <select
              id="job-type"
              name="employmentType"
              className="input"
              defaultValue={employmentType ?? ""}
            >
              <option value="">{copy.web.jobs.anyType}</option>
              {EMPLOYMENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="checkbox">
          <input
            id="job-verified"
            type="checkbox"
            name="verifiedOnly"
            value="true"
            defaultChecked={verifiedOnly}
          />
          <label htmlFor="job-verified">{copy.web.jobs.verifiedOnly}</label>
        </div>
        <div>
          <button type="submit" className="btn btn--primary">
            {copy.web.jobs.search}
          </button>
        </div>
      </form>

      {page.items.length === 0 ? (
        <EmptyState title={copy.web.jobs.emptyTitle}>
          <p>{copy.web.jobs.emptyBody}</p>
        </EmptyState>
      ) : (
        <ul className="list-plain">
          {page.items.map((job) => (
            <li key={job.id}>
              <article className="card stack" style={{ gap: 8 }}>
                <h2 className="card__title">
                  <Link href={`/jobs/${job.id}`}>{job.title}</Link>
                </h2>
                <p className="small muted" style={{ margin: 0 }}>
                  {job.employer.name} · {job.locality}, {job.countryCode} ·{" "}
                  {titleCase(job.employmentType)} ·{" "}
                  {fill(copy.web.jobs.closes, { date: formatDate(job.closesOn) })}
                </p>
                <p style={{ margin: 0 }}>
                  {job.salary?.label ?? copy.web.jobs.salaryNotAdvertised}
                </p>
                <div>
                  <Badge tone={job.employer.verified ? "verified" : "caution"}>
                    {job.employer.verified
                      ? copy.web.job.businessVerified
                      : copy.web.job.businessNotVerified}
                  </Badge>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
      {page.nextOffset !== null ? (
        <p>
          <Link className="btn btn--secondary" href={`/jobs?${next.toString()}`}>
            {copy.web.jobs.more}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
