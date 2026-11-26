"use client";

import { copy, fill } from "@fleettrust/copy";
import { errorMessage } from "@fleettrust/sdk";
import type { ServiceCategoryDto } from "@fleettrust/types";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/button";
import { Checkbox, TextArea, TextField } from "@/components/field";
import { ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.admin.taxonomy;

function CategoryEditor({
  category,
  onSaved,
}: {
  category: ServiceCategoryDto;
  onSaved: (c: ServiceCategoryDto) => void;
}) {
  const { api } = useSession();
  const [description, setDescription] = useState(category.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder));
  const [accepting, setAccepting] = useState(category.acceptingNewOfferings);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      onSaved(
        await api.updateServiceCategory(category.category, {
          description: description.trim() === "" ? null : description.trim(),
          sortOrder: Number(sortOrder),
          acceptingNewOfferings: accepting,
        }),
      );
      setMessage({ ok: true, text: t.saved });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={category.label}>
      <form className="stack" onSubmit={(event) => void save(event)}>
        <TextArea
          label={t.descriptionLabel}
          hint={t.descriptionHint}
          maxLength={500}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
        <TextField
          label={t.order}
          hint={t.orderHint}
          type="number"
          min={0}
          max={1000}
          value={sortOrder}
          onChange={(event) => {
            setSortOrder(event.target.value);
          }}
        />
        <Checkbox
          label={t.accepting}
          hint={t.acceptingHint}
          checked={accepting}
          onChange={(event) => {
            setAccepting(event.target.checked);
          }}
        />
        {message ? (
          <Notice tone={message.ok ? "success" : "danger"} live="polite">
            <p>{message.text}</p>
          </Notice>
        ) : null}
        <div>
          <Button type="submit" busy={busy}>
            {fill(t.save, { name: category.label })}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Service categories (super admins). The categories themselves are fixed in code; admins
 * manage their description, order and whether new offerings may use them.
 */
export default function TaxonomyPage() {
  const { api } = useSession();
  const categories = useLoad(() => api.taxonomy(), "admin-taxonomy");
  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {categories.status === "loading" ? <Loading /> : null}
      {categories.status === "error" ? (
        <ErrorNotice error={categories.error} onRetry={categories.reload} />
      ) : null}
      {categories.status === "ready"
        ? categories.data.map((category) => (
            <CategoryEditor
              key={category.category}
              category={category}
              onSaved={(saved) => {
                categories.setData(
                  categories.data
                    .map((c) => (c.category === saved.category ? saved : c))
                    .sort((a, b) => a.sortOrder - b.sortOrder),
                );
              }}
            />
          ))
        : null}
    </>
  );
}
