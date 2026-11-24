import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container container--readable stack">
      <h1>Page not found</h1>
      <p>This page doesn&apos;t exist, or it&apos;s no longer published.</p>
      <p>
        <Link href="/search">Find vehicle services</Link> or go to the{" "}
        <Link href="/">home page</Link>.
      </p>
    </div>
  );
}
