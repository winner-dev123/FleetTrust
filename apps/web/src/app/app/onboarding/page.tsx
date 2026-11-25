"use client";

import { copy } from "@fleettrust/copy";
import type { OrganizationKind } from "@fleettrust/types";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";

import { Button, ButtonLink } from "@/components/button";
import { TextField } from "@/components/field";
import { Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { useAccount } from "@/lib/account";
import { errorMessage } from "@fleettrust/sdk";
import { useSession } from "@/lib/session";

const t = copy.web.app.onboarding;

type Path = "personal" | OrganizationKind;

const PATHS: { value: Path; title: string; text: string }[] = [
  {
    value: "personal",
    title: t.personalTitle,
    text: t.personalText,
  },
  {
    value: "provider",
    title: t.providerTitle,
    text: t.providerText,
  },
  {
    value: "fleet",
    title: t.fleetTitle,
    text: t.fleetText,
  },
];

/** First-run setup: a display name, then the person's path. Only what's needed, nothing more. */
export default function OnboardingPage() {
  const { api } = useSession();
  const { me, refresh } = useAccount();
  const router = useRouter();
  const [name, setName] = useState(me.displayName ?? "");
  const [path, setPath] = useState<Path>("personal");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = name.trim();
    if (displayName.length < 1 || displayName.length > 50) {
      setError(t.nameInvalid);
      return;
    }
    if (path !== "personal" && orgName.trim().length < 2) {
      setError(t.orgMissing);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (displayName !== me.displayName) await api.updateMe({ displayName });
      let destination = "/app";
      if (path !== "personal") {
        const created = await api.createOrganization({ kind: path, name: orgName.trim() });
        destination = `/app/o/${created.organization.id}`;
      }
      await refresh();
      router.push(destination);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      <form className="stack stack--lg" onSubmit={(event) => void submit(event)} noValidate>
        <Card title={t.stepName}>
          <TextField
            label={t.displayName}
            hint={t.displayNameHint}
            required
            maxLength={50}
            autoComplete="nickname"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Card>
        <Card title={t.stepPath}>
          <fieldset className="field">
            <legend className="visually-hidden">{t.pathLegend}</legend>
            <div className="stack">
              {PATHS.map((option) => (
                <label key={option.value} className="card checkbox" style={{ cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="path"
                    value={option.value}
                    checked={path === option.value}
                    onChange={() => {
                      setPath(option.value);
                    }}
                    style={{ width: 22, height: 22, flex: "none" }}
                  />
                  <span>
                    <strong>{option.title}</strong>
                    <span className="small muted" style={{ display: "block" }}>
                      {option.text}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {path !== "personal" ? (
            <div style={{ marginTop: 16 }}>
              <TextField
                label={path === "provider" ? t.businessName : t.fleetName}
                required
                maxLength={100}
                autoComplete="organization"
                value={orgName}
                onChange={(event) => {
                  setOrgName(event.target.value);
                }}
              />
            </div>
          ) : null}
        </Card>
        {error ? (
          <Notice tone="danger" live="assertive">
            <p>{error}</p>
          </Notice>
        ) : null}
        <div className="cluster">
          <Button type="submit" busy={busy}>
            {busy ? t.saving : t.continue}
          </Button>
          <ButtonLink variant="ghost" href="/app">
            {t.skip}
          </ButtonLink>
        </div>
      </form>
    </>
  );
}
