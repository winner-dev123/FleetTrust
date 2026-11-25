import { createApiClient } from "@fleettrust/sdk";
import {
  COMMUNITY_CONTENT_LABEL,
  DEFAULT_MESSAGING_PREFERENCES,
  INDICATIVE_PRICE_DISCLAIMER,
  type MessageDto,
} from "@fleettrust/types";

import { createRuntime, type Runtime } from "../src/platform/runtime";
import type { FakeDevice } from "./fake-platform";
import * as f from "./fixtures";

interface Call {
  method: string;
  path: string;
  body: unknown;
  authorized: boolean;
}

interface Reply {
  status?: number;
  body?: unknown;
}
type Handler = (input: { params: string[]; body: Record<string, unknown>; query: string }) => Reply;

/**
 * An in-memory FleetTrust API behind a fake `fetch`. Responses pass through the real SDK,
 * which validates them against the shared schemas, so a fixture that drifts from the API
 * contract fails the test. `offline = true` makes every request fail like a dropped signal.
 */
export class FakeApi {
  readonly calls: Call[] = [];
  offline = false;
  readonly messages: MessageDto[] = [f.message(1, "Hello, how can we help?")];
  private readonly routes: { method: string; pattern: RegExp; handle: Handler }[] = [];
  private seq = 1;

  constructor() {
    this.on("GET", "/v1/me", () => ({ body: f.me }));
    this.on("GET", "/v1/me/messaging-preferences", () => ({ body: DEFAULT_MESSAGING_PREFERENCES }));
    this.on("PUT", "/v1/me/devices", () => ({ status: 204 }));
    this.on("POST", "/v1/me/devices/unregister", () => ({ status: 204 }));
    this.on("GET", "/v1/geo/map-config", () => ({
      body: { provider: "stub", tileUrl: null, attribution: null },
    }));
    this.on("GET", "/v1/geo/geocode", () => ({
      body: [
        {
          label: "Woodstock, Cape Town",
          location: { lat: -33.927, lng: 18.447 },
          countryCode: "ZA",
        },
      ],
    }));
    for (const full of [false, true]) {
      this.on("GET", `/v1/search/providers${full ? "/full" : ""}`, () => ({
        body: {
          results: [f.searchResult],
          nextCursor: null,
          ranking: "relevance",
          priceDisclaimer: INDICATIVE_PRICE_DISCLAIMER,
        },
      }));
      this.on("GET", `/v1/providers/:slug${full ? "/full" : ""}`, () => ({ body: f.profile }));
    }
    this.on("GET", "/v1/me/service-requests", () => ({ body: [f.serviceRequest()] }));
    this.on("POST", "/v1/me/service-requests", ({ body }) => ({
      status: 201,
      body: f.serviceRequest({ description: String(body["description"]) }),
    }));
    this.on("GET", "/v1/me/service-requests/:id", () => ({ body: f.serviceRequest() }));
    this.on("GET", "/v1/conversations", () => ({ body: [f.conversation] }));
    this.on("GET", "/v1/conversations/:id", () => ({ body: f.conversation }));
    this.on("GET", "/v1/conversations/:id/messages", () => ({
      body: { items: this.messages, more: false },
    }));
    this.on("POST", "/v1/conversations/:id/messages", ({ body }) => {
      const existing = this.messages.find((m) => m.clientMessageId === body["clientMessageId"]);
      if (existing) return { status: 201, body: existing };
      this.seq += 1;
      const sent = f.message(this.seq, String(body["body"]), {
        clientMessageId: String(body["clientMessageId"]),
        sender: { userId: f.IDS.user, name: "Sam Driver", side: "requester", mine: true },
      });
      this.messages.push(sent);
      return { status: 201, body: sent };
    });
    this.on("POST", "/v1/conversations/:id/read", () => ({ body: { lastReadSeq: this.seq } }));
    this.on("GET", "/v1/emergency/guidance", () => ({ body: f.guidance }));
    this.on("GET", "/v1/me/trusted-contacts", () => ({ body: [f.activeContact] }));
    this.on("GET", "/v1/emergency/incidents", () => ({ body: [] }));
    this.on("POST", "/v1/emergency/incidents", ({ body }) => ({
      status: 201,
      body: f.incident({
        category: body["category"] as "breakdown",
        note: (body["note"] as string | null) ?? null,
      }),
    }));
    this.on("GET", "/v1/emergency/incidents/:id", () => ({
      body: f.incident({ category: "breakdown" }),
    }));
    this.on("GET", "/v1/articles", () => ({
      body: { items: [f.articleSummary], nextCursor: null, label: COMMUNITY_CONTENT_LABEL },
    }));
    this.on("GET", "/v1/me/inbox", () => ({
      body: { notifications: [], unreadNotifications: 0, unreadConversations: 0 },
    }));
  }

  /** Adds or replaces a route. `:param` matches one path segment. */
  on(method: string, path: string, handle: Handler): void {
    const pattern = new RegExp(`^${path.replace(/:[a-z]+/gi, "([^/]+)")}$`);
    const index = this.routes.findIndex(
      (route) => route.method === method && route.pattern.source === pattern.source,
    );
    const route = { method, pattern, handle };
    if (index === -1) this.routes.push(route);
    else this.routes[index] = route;
  }

  callsTo(method: string, path: string | RegExp): Call[] {
    return this.calls.filter(
      (call) =>
        call.method === method &&
        (typeof path === "string" ? call.path === path : path.test(call.path)),
    );
  }

  readonly fetch: typeof globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const [, pathAndQuery = "/"] = /^https?:\/\/[^/]+(\/.*)?$/.exec(url) ?? [];
    const [path = "/", query = ""] = pathAndQuery.split("?", 2);
    const method = init?.method ?? "GET";
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    this.calls.push({
      method,
      path,
      body,
      authorized: typeof headers["Authorization"] === "string",
    });
    if (this.offline) return Promise.reject(new TypeError("Network request failed"));
    for (const route of this.routes) {
      const match = route.method === method ? route.pattern.exec(path) : null;
      if (!match) continue;
      const reply = route.handle({
        params: match.slice(1).map((value) => decodeURIComponent(value)),
        body: (body ?? {}) as Record<string, unknown>,
        query,
      });
      return Promise.resolve(response(reply.status ?? 200, reply.body));
    }
    return Promise.resolve(
      response(404, { statusCode: 404, message: `No fake route for ${method} ${path}` }),
    );
  };
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

export function fakeRuntime(device: FakeDevice, api: FakeApi): Runtime {
  return createRuntime(device.platform, {
    api: createApiClient({
      baseUrl: "https://api.test",
      fetch: api.fetch,
      getIdToken: () => device.platform.auth.idToken(),
    }),
    // An inert socket: screen tests use REST; the realtime client has its own tests.
    createSocket: () => ({
      send: () => undefined,
      close: () => undefined,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    }),
  });
}
