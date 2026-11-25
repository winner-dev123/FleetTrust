"use client";

import { errorMessage } from "@fleettrust/sdk";
import { type FeatureSettingDto, formatDateTime } from "@fleettrust/types";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/button";
import { Checkbox, TextArea, TextField } from "@/components/field";
import { ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

/** One setting with an editor that fits its type (on/off, number, short text). */
function SettingEditor({
  setting,
  onSaved,
}: {
  setting: FeatureSettingDto;
  onSaved: (s: FeatureSettingDto) => void;
}) {
  const { api } = useSession();
  const [value, setValue] = useState<unknown>(setting.value);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const kind =
    typeof setting.defaultValue === "boolean"
      ? "boolean"
      : typeof setting.defaultValue === "number"
        ? "number"
        : "text";

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const next =
        kind === "text" && typeof value === "string" && value.trim() === "" ? null : value;
      onSaved(await api.setFeatureSetting(setting.key, next));
      setMessage({ ok: true, text: "Saved." });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={setting.label}>
      <form className="stack" onSubmit={(event) => void save(event)}>
        <p className="small" style={{ margin: 0 }}>
          {setting.description}
        </p>
        {kind === "boolean" ? (
          <Checkbox
            label="On"
            checked={value === true}
            onChange={(event) => {
              setValue(event.target.checked);
            }}
          />
        ) : kind === "number" ? (
          <TextField
            label="Value"
            type="number"
            value={typeof value === "number" ? String(value) : ""}
            onChange={(event) => {
              setValue(Number(event.target.value));
            }}
          />
        ) : (
          <TextArea
            label="Text"
            hint="Leave empty to hide it."
            maxLength={280}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => {
              setValue(event.target.value);
            }}
          />
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Default: {JSON.stringify(setting.defaultValue)} ·{" "}
          {setting.public ? "Shown to everyone" : "Server only"}
          {setting.updatedAt
            ? ` · last changed ${formatDateTime(setting.updatedAt)} by ${setting.updatedBy ?? "staff"}`
            : ""}
        </p>
        {message ? (
          <Notice tone={message.ok ? "success" : "danger"} live="polite">
            <p>{message.text}</p>
          </Notice>
        ) : null}
        <div>
          <Button type="submit" busy={busy}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Feature settings (super admins). A fixed list of real server-side settings; there are no
 * switches for unbuilt features (ADR-0011). Changes are audited with the before and after.
 */
export default function FeaturesPage() {
  const { api } = useSession();
  const settings = useLoad(() => api.featureSettings(), "admin-features");
  return (
    <>
      <PageHeader
        title="Feature settings"
        description="Changes apply straight away and are recorded in the audit log."
      />
      {settings.status === "loading" ? <Loading /> : null}
      {settings.status === "error" ? (
        <ErrorNotice error={settings.error} onRetry={settings.reload} />
      ) : null}
      {settings.status === "ready"
        ? settings.data.map((setting) => (
            <SettingEditor
              key={setting.key}
              setting={setting}
              onSaved={(saved) => {
                settings.setData(settings.data.map((s) => (s.key === saved.key ? saved : s)));
              }}
            />
          ))
        : null}
    </>
  );
}
