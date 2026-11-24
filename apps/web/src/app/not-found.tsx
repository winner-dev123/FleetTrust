import Link from "next/link";

/** Fallback for addresses outside every section. */
export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="container container--readable stack">
      <h1>Page not found</h1>
      <p>
        This page doesn&apos;t exist. Go to the <Link href="/">home page</Link>.
      </p>
    </main>
  );
}
