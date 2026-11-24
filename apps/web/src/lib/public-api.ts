import { createApiClient } from "@fleettrust/sdk";

import { webEnv } from "@/env";

/**
 * Server-side client for public pages (no user token). Pages that use it render on request,
 * so visitors and search engines get the content without running JavaScript.
 */
export function publicApi() {
  return createApiClient({ baseUrl: webEnv.apiUrl, timeoutMs: 8_000 });
}
