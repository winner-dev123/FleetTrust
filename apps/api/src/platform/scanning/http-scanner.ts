import type { MalwareScanner, ScanResult } from "./malware-scanner.js";

/** Headers that authorise one call to the scanner (a Google identity token on Cloud Run). */
export type ScannerAuth = (url: string) => Promise<Record<string, string>>;

/**
 * ClamAV behind the FleetTrust scanner service over HTTPS (apps/scanner, ADR-0037): the file is
 * POSTed to `<url>/scan`, and the service answers `{ clean: true }` or
 * `{ clean: false, signature }`. Any other status or body, a timeout or a network error is an
 * exception, so the upload stays quarantined (fail closed), as with clamd over TCP.
 *
 * The timeout is longer than clamd's: after a quiet period the service starts from zero and
 * ClamAV loads its signatures (20–60 s) before the first scan.
 */
export class ClamAvHttpScanner implements MalwareScanner {
  readonly name = "clamav";

  constructor(
    private readonly url: string,
    private readonly auth: ScannerAuth,
    private readonly timeoutMs = 150_000,
  ) {}

  async scan(data: Buffer): Promise<ScanResult> {
    const endpoint = new URL("/scan", this.url).toString();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", ...(await this.auth(this.url)) },
      body: new Uint8Array(data),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`scanner answered ${response.status}`);
    }
    const body = (await response.json()) as unknown;
    if (isScanResult(body))
      return body.clean ? { clean: true } : { clean: false, signature: body.signature };
    throw new Error("scanner answered an unexpected body");
  }
}

function isScanResult(
  body: unknown,
): body is { clean: true } | { clean: false; signature: string } {
  if (typeof body !== "object" || body === null) return false;
  const { clean, signature } = body as { clean?: unknown; signature?: unknown };
  return clean === true || (clean === false && typeof signature === "string" && signature !== "");
}

/** Minimal surface of google-auth-library's GoogleAuth used here (injectable for tests). */
interface IdTokenSource {
  getIdTokenClient(audience: string): Promise<{
    getRequestHeaders(url?: string): Promise<Headers | Record<string, string>>;
  }>;
}

/**
 * Google identity token for a Cloud Run service (the service URL is the audience). Plain
 * `http://` URLs (a scanner on the developer's machine) get no token.
 */
export function googleIdTokenAuth(source: IdTokenSource): ScannerAuth {
  const clients = new Map<string, ReturnType<IdTokenSource["getIdTokenClient"]>>();
  return async (url) => {
    if (!url.startsWith("https://")) return {};
    const audience = new URL(url).origin;
    let client = clients.get(audience);
    if (!client) {
      client = source.getIdTokenClient(audience);
      clients.set(audience, client);
      // Don't keep a failed lookup (for example a metadata server hiccup): retry next time.
      client.catch(() => clients.delete(audience));
    }
    const headers = await (await client).getRequestHeaders(audience);
    return headers instanceof Headers ? Object.fromEntries(headers.entries()) : { ...headers };
  };
}
