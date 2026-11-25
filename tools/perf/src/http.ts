/** Small HTTP and test-identity helpers for the load scenarios. */

export interface Reply {
  status: number;
  body: unknown;
}

export class Api {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async call(
    method: string,
    path: string,
    options: { token?: string; body?: unknown; ip?: string } = {},
  ): Promise<Reply> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    // The API trusts one proxy hop in this run (TRUST_PROXY_HOPS=1), so each simulated
    // visitor gets its own address and its own per-IP rate limit.
    if (options.ip) headers["X-Forwarded-For"] = options.ip;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text === "" ? null : JSON.parse(text);
    } catch {
      // Not JSON: keep the text for error messages.
    }
    return { status: response.status, body };
  }

  /** Throws unless the status is one of `ok`. */
  async expect(
    method: string,
    path: string,
    ok: number | number[],
    options: { token?: string; body?: unknown; ip?: string } = {},
  ): Promise<unknown> {
    const reply = await this.call(method, path, options);
    const allowed = Array.isArray(ok) ? ok : [ok];
    if (!allowed.includes(reply.status)) {
      throw new Error(
        `${method} ${path} -> ${String(reply.status)} ${JSON.stringify(reply.body).slice(0, 300)}`,
      );
    }
    return reply.body;
  }
}

export interface TestUser {
  email: string;
  token: string;
  id: string;
}

/**
 * A signed-in test user: Google sign-in through the Firebase Auth emulator's fake IdP, then
 * the first API call creates the FleetTrust account (with a display name).
 */
export async function testUser(api: Api, emulatorHost: string, email: string): Promise<TestUser> {
  const response = await fetch(
    `http://${emulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=perf`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: email, email, email_verified: true }))}&providerId=google.com`,
        requestUri: "http://localhost",
        returnSecureToken: true,
      }),
    },
  );
  if (!response.ok)
    throw new Error(`emulator sign-in failed: ${String(response.status)} ${await response.text()}`);
  const { idToken } = (await response.json()) as { idToken: string };
  const me = (await api.expect("PATCH", "/v1/me", 200, {
    token: idToken,
    body: { displayName: email.split("@")[0]?.slice(0, 40) ?? "perf" },
  })) as { id: string };
  return { email, token: idToken, id: me.id };
}

/** Creates users `count` at a time (the emulator and the API both handle a few in parallel). */
export async function testUsers(
  api: Api,
  emulatorHost: string,
  prefix: string,
  count: number,
): Promise<TestUser[]> {
  const users: TestUser[] = [];
  for (let i = 0; i < count; i += 10) {
    const batch = Array.from({ length: Math.min(10, count - i) }, (_, j) =>
      testUser(api, emulatorHost, `${prefix}-${String(i + j)}@perf.test`),
    );
    users.push(...(await Promise.all(batch)));
  }
  return users;
}

/** A random point inside the seeded area (around Johannesburg). */
export function randomPoint(): { lng: number; lat: number } {
  return { lng: 27.6 + Math.random(), lat: -26.6 + Math.random() * 0.8 };
}

export const randomIp = () =>
  `10.${String(Math.floor(Math.random() * 256))}.${String(Math.floor(Math.random() * 256))}.${String(1 + Math.floor(Math.random() * 254))}`;
