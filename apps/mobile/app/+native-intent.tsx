import { resolveIncomingUrl } from "../src/lib/links";
import { mobileEnv } from "../src/env";

/**
 * Every URL the OS hands the app (custom scheme, universal / app links, email sign-in links)
 * passes through here first and is mapped to a known screen; anything else opens home.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return resolveIncomingUrl(path, { webUrl: mobileEnv.webUrl, linkDomain: mobileEnv.linkDomain });
  } catch {
    return "/";
  }
}
