import { ApiError } from "@fleettrust/sdk";
import type { PublicJob } from "@fleettrust/types";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Badge, Notice } from "@/components/feedback";
import { ReportButton } from "@/components/report-button";
import { formatDate, titleCase } from "@fleettrust/types";
import { publicApi } from "@/lib/public-api";

import { ApplyForm } from "./apply-form";

export const dynamic = "force-dynamic";

const loadJob = cache(async (id: string): Promise<PublicJob> => {
  try {
    return await publicApi().job(id);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
});

export async function generateMetadata(props: PageProps<"/jobs/[id]">): Promise<Metadata> {
  const job = await loadJob((await props.params).id);
  return { title: `${job.title} · ${job.employer.name}` };
}

export default async function JobPage(props: PageProps<"/jobs/[id]">) {
  const job = await loadJob((await props.params).id);
  return (
    <div className="container container--readable stack stack--lg">
      <header className="stack" style={{ gap: 8 }}>
        <p className="small">
          <Link href="/jobs">Jobs</Link>
        </p>
        <h1>{job.title}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {job.employer.name} · {job.locality}, {job.countryCode}
        </p>
        <div>
          <Badge tone={job.employer.verified ? "verified" : "caution"}>
            {job.employer.verified ? "Business verified" : "Business not verified"}
          </Badge>
        </div>
      </header>
      <Notice tone="caution" title="Stay safe">
        <p>{job.scamWarning}</p>
        {job.employerNotice ? <p>{job.employerNotice}</p> : null}
      </Notice>
      <dl className="card stack" style={{ gap: 8 }}>
        <div>
          <dt className="small muted">Salary</dt>
          <dd style={{ margin: 0 }}>{job.salary?.label ?? "Not advertised"}</dd>
        </div>
        <div>
          <dt className="small muted">Type</dt>
          <dd style={{ margin: 0 }}>
            {titleCase(job.employmentType)} · {titleCase(job.role)}
          </dd>
        </div>
        {job.licenceClasses.length > 0 ? (
          <div>
            <dt className="small muted">Licence</dt>
            <dd style={{ margin: 0 }}>{job.licenceClasses.join(", ")}</dd>
          </div>
        ) : null}
        <div>
          <dt className="small muted">Closes</dt>
          <dd style={{ margin: 0 }}>{formatDate(job.closesOn)}</dd>
        </div>
      </dl>
      <section aria-labelledby="description-heading">
        <h2 id="description-heading">About the job</h2>
        <p style={{ whiteSpace: "pre-line" }}>{job.description}</p>
      </section>
      <ApplyForm jobId={job.id} />
      <ReportButton targetType="job" targetId={job.id} what="job listing" />
    </div>
  );
}
