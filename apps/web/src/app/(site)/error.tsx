"use client";

import { copy } from "@fleettrust/copy";
import { Notice } from "@/components/feedback";

/** Shown when a public page couldn't load (for example the API is unreachable). */
export default function SiteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container container--readable stack">
      <h1>{copy.web.errors.loadFailedTitle}</h1>
      <Notice tone="danger" live="assertive">
        <p>{copy.web.errors.loadFailedBody}</p>
      </Notice>
      <p>
        <button type="button" className="btn btn--primary" onClick={reset}>
          {copy.common.tryAgain}
        </button>
      </p>
      <p>
        {copy.web.errors.roadHelpBefore} <a href="/emergency">{copy.web.errors.roadHelpLink}</a>.
      </p>
    </div>
  );
}
