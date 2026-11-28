import { createApiClient } from "@fleettrust/sdk";

import { webEnv } from "@/env";

/**
 * Server-side client for public pages (no user token). Pages that use it render on request,
 * so visitors and search engines get the content without running JavaScript.
 */
export function publicApi() {
  // Long enough for an API cold start (it scales to zero, ADR-0037).
  return createApiClient({ baseUrl: webEnv.apiUrl, timeoutMs: 25_000 });
}
