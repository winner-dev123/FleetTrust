import { copy } from "@fleettrust/copy";
import Link from "next/link";

/** Fallback for addresses outside every section. */
export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="container container--readable stack">
      <h1>{copy.web.errors.pageNotFound}</h1>
      <p>
        {copy.web.errors.pageMissing} <Link href="/">{copy.web.errors.homePage}</Link>.
      </p>
    </main>
  );
}
