/**
 * Where to send someone after they sign in. Only same-site paths are accepted, so a crafted
 * `?next=` can't bounce a fresh session to another site (open redirect).
 */
const KEY = "fleettrust.returnPath";

export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) < 0x20) return null;
  if (value.startsWith("/sign-in") || value.startsWith("/auth/")) return null;
  return value.length <= 512 ? value : null;
}

export function rememberReturnPath(storage: Storage, value: string | null | undefined): void {
  const path = safeReturnPath(value);
  try {
    if (path === null) storage.removeItem(KEY);
    else storage.setItem(KEY, path);
  } catch {
    // Storage blocked: the person lands on the dashboard instead.
  }
}

/** Reads and forgets the remembered path. */
export function takeReturnPath(storage: Storage): string | null {
  try {
    const path = safeReturnPath(storage.getItem(KEY));
    storage.removeItem(KEY);
    return path;
  } catch {
    return null;
  }
}
