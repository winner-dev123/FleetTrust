"use client";

import type { MyOrganization } from "@fleettrust/types";
import Link from "next/link";
import { useState } from "react";

import { Button, ButtonLink } from "@/components/button";
import { Badge, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { errorMessage } from "@/lib/errors";
import { formatDate, titleCase } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const STEP_LINKS: Record<string, { label: string; path: string }> = {
  basics: { label: "Business name and description", path: "profile" },
  categories: { label: "Service categories", path: "profile" },
  vehicles: { label: "Vehicles you work on", path: "profile" },
  contact: { label: "Contact details", path: "profile" },
  branches: { label: "Branch location", path: "branches" },
  catalog: { label: "Services and indicative prices", path: "services" },
  hours: { label: "Opening hours", path: "branches" },
  media: { label: "Logo and photos", path: "profile" },
};

/** Provider onboarding: a checklist of what's needed to publish, then publishing itself. */
export function ProviderOverview({ membership }: { membership: MyOrganization }) {
  const { api } = useSession();
  const orgId = membership.organization.id;
  const data = useLoad(async () => {
    const [profile, cases] = await Promise.all([
      api.providerProfile(orgId),
      api.verificationCases(orgId).catch(() => []),
    ]);
    return { profile, cases };
  }, `provider-${orgId}`);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = membership.permissions.includes("profile.manage");

  async function publish() {
    setBusy(true);
    setMessage(null);
    try {
      await api.publishProviderProfile(orgId);
      setMessage({ ok: true, text: "Your profile is published and appears in search." });
      data.reload();
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={membership.organization.name}
        description="Service provider · set up your public profile"
      />
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      {data.status === "loading" ? <Loading /> : null}
      {data.status === "error" ? <ErrorNotice error={data.error} onRetry={data.reload} /> : null}
      {data.status === "ready" ? (
        <>
          <Card title="Public profile">
            <p>
              <Badge tone={data.data.profile.status === "published" ? "verified" : "neutral"}>
                {titleCase(data.data.profile.status)}
              </Badge>
              {data.data.profile.publishedAt
                ? ` · published ${formatDate(data.data.profile.publishedAt)}`
                : ""}
              {data.data.profile.hasUnpublishedChanges ? " · you have unpublished changes" : ""}
            </p>
            {data.data.profile.slug && data.data.profile.status === "published" ? (
              <p>
                <Link href={`/providers/${data.data.profile.slug}`}>View your public profile</Link>
              </p>
            ) : null}
            {canManage ? (
              <div className="cluster">
                <Button
                  onClick={() => void publish()}
                  busy={busy}
                  disabled={!data.data.profile.canPublish}
                >
                  {data.data.profile.status === "published" ? "Publish changes" : "Publish profile"}
                </Button>
                {!data.data.profile.canPublish ? (
                  <span className="small muted">Finish the steps below first.</span>
                ) : null}
              </div>
            ) : null}
          </Card>

          <Card title="Setup checklist">
            <ol className="steps">
              {data.data.profile.steps.map((step, index) => {
                const link = STEP_LINKS[step.id];
                return (
                  <li key={step.id}>
                    <span className="steps__mark" data-done={step.complete} aria-hidden="true">
                      {step.complete ? "✓" : String(index + 1)}
                    </span>
                    <span>
                      <strong>{link?.label ?? titleCase(step.id)}</strong>{" "}
                      <span className="visually-hidden">
                        {step.complete ? "(done)" : "(to do)"}
                      </span>
                      {step.issues.map((issue) => (
                        <span
                          key={`${issue.path}-${issue.message}`}
                          className="small muted"
                          style={{ display: "block" }}
                        >
                          {issue.message}
                        </span>
                      ))}
                      {link && canManage && !step.complete ? (
                        <Link className="small" href={`/app/o/${orgId}/${link.path}`}>
                          Fix this
                        </Link>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card title="Verification">
            <p>
              Verification shows customers what FleetTrust checked, such as your business
              registration. It&apos;s based on documents only: no plan can buy it.
            </p>
            {data.data.cases.length === 0 ? (
              <p className="muted">No verification applications yet.</p>
            ) : (
              <ul className="list-plain">
                {data.data.cases.map((verification) => (
                  <li key={verification.id}>
                    {titleCase(verification.badgeType)}:{" "}
                    <Badge tone={verification.status === "approved" ? "verified" : "neutral"}>
                      {titleCase(verification.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="cluster">
            <ButtonLink variant="secondary" href={`/app/o/${orgId}/usage`}>
              Plan usage
            </ButtonLink>
          </div>
        </>
      ) : null}
    </>
  );
}
