"use client";

import { copy, fill } from "@fleettrust/copy";
import type { MyOrganization } from "@fleettrust/types";
import Link from "next/link";
import { useState } from "react";

import { Button, ButtonLink } from "@/components/button";
import { Badge, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { errorMessage } from "@fleettrust/sdk";
import { formatDate, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.org.provider;

const STEP_LINKS: Record<string, { label: string; path: string }> = {
  basics: { label: t.stepBasics, path: "profile" },
  categories: { label: t.stepCategories, path: "profile" },
  vehicles: { label: t.stepVehicles, path: "profile" },
  contact: { label: t.stepContact, path: "profile" },
  branches: { label: t.stepBranches, path: "branches" },
  catalog: { label: t.stepCatalog, path: "services" },
  hours: { label: t.stepHours, path: "branches" },
  media: { label: t.stepMedia, path: "profile" },
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
      setMessage({ ok: true, text: t.published });
      data.reload();
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={membership.organization.name} description={t.description} />
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      {data.status === "loading" ? <Loading /> : null}
      {data.status === "error" ? <ErrorNotice error={data.error} onRetry={data.reload} /> : null}
      {data.status === "ready" ? (
        <>
          <Card title={t.publicProfile}>
            <p>
              <Badge tone={data.data.profile.status === "published" ? "verified" : "neutral"}>
                {titleCase(data.data.profile.status)}
              </Badge>
              {data.data.profile.publishedAt
                ? ` · ${fill(t.publishedOn, { date: formatDate(data.data.profile.publishedAt) })}`
                : ""}
              {data.data.profile.hasUnpublishedChanges ? ` · ${t.unpublishedChanges}` : ""}
            </p>
            {data.data.profile.slug && data.data.profile.status === "published" ? (
              <p>
                <Link href={`/providers/${data.data.profile.slug}`}>{t.viewPublic}</Link>
              </p>
            ) : null}
            {canManage ? (
              <div className="cluster">
                <Button
                  onClick={() => void publish()}
                  busy={busy}
                  disabled={!data.data.profile.canPublish}
                >
                  {data.data.profile.status === "published" ? t.publishChanges : t.publishProfile}
                </Button>
                {!data.data.profile.canPublish ? (
                  <span className="small muted">{t.finishFirst}</span>
                ) : null}
              </div>
            ) : null}
          </Card>

          <Card title={t.checklist}>
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
                      <span className="visually-hidden">{step.complete ? t.done : t.toDo}</span>
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
                          {t.fix}
                        </Link>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card title={t.verification}>
            <p>{t.verificationBody}</p>
            {data.data.cases.length === 0 ? (
              <p className="muted">{t.noVerification}</p>
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
              {t.planUsage}
            </ButtonLink>
          </div>
        </>
      ) : null}
    </>
  );
}
