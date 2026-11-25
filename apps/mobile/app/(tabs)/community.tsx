import { copy } from "@fleettrust/copy";
import { formatDate, titleCase } from "@fleettrust/types";
import { useRouter } from "expo-router";

import { ErrorNotice } from "../../src/components/feedback";
import { Body, EmptyState, Heading, ListRow, Loading, Screen } from "../../src/components/ui";
import { useLoad } from "../../src/lib/use-load";
import { useSession } from "../../src/state/session";

/** Knowledge hub: articles written by the community. Readable without signing in. */
export default function CommunityScreen() {
  const { api } = useSession();
  const router = useRouter();
  const page = useLoad(() => api.searchArticles(), "articles");

  return (
    <Screen>
      <Heading>{copy.communityTab.title}</Heading>
      {page.status === "loading" ? <Loading /> : null}
      {page.status === "error" ? <ErrorNotice error={page.error} onRetry={page.reload} /> : null}
      {page.status === "ready" ? (
        <>
          <Body small muted>
            {page.data.label}
          </Body>
          {page.data.items.length === 0 ? (
            <EmptyState title={copy.communityTab.emptyTitle} />
          ) : null}
          {page.data.items.map((article) => (
            <ListRow
              key={article.id}
              title={article.title}
              subtitle={`${titleCase(article.category)} · ${article.author.displayName} · ${formatDate(article.publishedAt)}`}
              detail={article.summary ? <Body small>{article.summary}</Body> : null}
              onPress={() => {
                router.push(`/articles/${article.slug}`);
              }}
            />
          ))}
        </>
      ) : null}
    </Screen>
  );
}
