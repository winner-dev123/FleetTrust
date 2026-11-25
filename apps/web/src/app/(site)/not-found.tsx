import { copy } from "@fleettrust/copy";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container container--readable stack">
      <h1>{copy.web.errors.pageNotFound}</h1>
      <p>{copy.web.errors.pageGone}</p>
      <p>
        <Link href="/search">{copy.web.errors.findServices}</Link> {copy.web.errors.orGoToThe}{" "}
        <Link href="/">{copy.web.errors.homePage}</Link>.
      </p>
    </div>
  );
}
