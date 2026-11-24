import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/feedback";

import { SearchView } from "./search-view";

export const metadata: Metadata = {
  title: "Find vehicle services",
  description: "Search workshops, towing, tyres, parts and more near you.",
};

export default function SearchPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SearchView />
    </Suspense>
  );
}
