import { copy } from "@fleettrust/copy";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/feedback";

import { SearchView } from "./search-view";

export const metadata: Metadata = {
  title: copy.web.searchPage.title,
  description: copy.web.searchPage.description,
};

export default function SearchPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SearchView />
    </Suspense>
  );
}
