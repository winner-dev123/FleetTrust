"use client";

import { Notice } from "@/components/feedback";

/** Shown when a public page couldn't load (for example the API is unreachable). */
export default function SiteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container container--readable stack">
      <h1>This page couldn&apos;t load</h1>
      <Notice tone="danger" live="assertive">
        <p>Something went wrong while loading this page. Please try again in a moment.</p>
      </Notice>
      <p>
        <button type="button" className="btn btn--primary" onClick={reset}>
          Try again
        </button>
      </p>
      <p>
        If you need help on the road now, see <a href="/emergency">emergency help</a>.
      </p>
    </div>
  );
}
