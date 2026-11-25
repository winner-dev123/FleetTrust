import { randomUUID } from "node:crypto";

import type pg from "pg";
import NodeWebSocket from "ws";

import { type Api, randomIp, randomPoint, type Reply, type TestUser, testUsers } from "./http.ts";
import { type LatencySummary, runLoad, summarize } from "./stats.ts";

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** The realtime gateway's gap wait (apps/api GAP_WAIT_MS), for reading diagnostics. */
const GAP_HINT_MS = 1_000;

const reasonOf = (reply: Reply): string | undefined =>
  (reply.body as { reason?: string } | null)?.reason;

export interface ScenarioResult {
  key: string;
  summary: LatencySummary;
  /** Correctness checks: any failure fails the run. */
  checks: { name: string; ok: boolean; detail: string }[];
  notes: string[];
  samples: string[];
}

const check = (name: string, ok: boolean, detail: string) => ({ name, ok, detail });

// ---------------------------------------------------------------------------------------------
// 1. Geospatial search
// ---------------------------------------------------------------------------------------------

export async function searchScenario(
  api: Api,
  db: pg.Client,
  options: { concurrency: number; durationMs: number; providers: number; stress?: boolean },
): Promise<ScenarioResult> {
  // How many branches a 25 km search has to rank (the main cost: each is scored).
  const { rows } = await db.query<{ avg: string }>(
    `SELECT round(avg(n))::text AS avg FROM (
       SELECT (SELECT count(*) FROM provider_search_entries e
               WHERE ST_DWithin(e.location, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography, 25000)) AS n
       FROM (SELECT 27.6 + random() AS lng, -26.6 + random() * 0.8 AS lat
             FROM generate_series(1, 20)) p) s`,
  );
  const candidates = rows[0]?.avg ?? "?";
  let empty = 0;
  const result = await runLoad(async () => {
    const { lng, lat } = randomPoint();
    const reply = await api.call(
      "GET",
      `/v1/search/providers?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&radiusKm=25&category=workshop&limit=20`,
      { ip: randomIp() },
    );
    if (reply.status !== 200)
      throw new Error(
        `search -> ${String(reply.status)} ${JSON.stringify(reply.body).slice(0, 200)}`,
      );
    if (((reply.body as { results?: unknown[] }).results ?? []).length === 0) empty += 1;
  }, options);
  const summary = summarize(result.latencies, result.errors, result.windowMs);
  return {
    key: options.stress ? "searchStress" : "search",
    summary,
    checks: [
      check(
        "searches return providers",
        empty < summary.count * 0.05,
        `${String(empty)} empty of ${String(summary.count)}`,
      ),
    ],
    notes: [
      `${String(options.providers)} provider branches; ${String(options.concurrency)} concurrent visitors for ${String(options.durationMs / 1000)} s, random points, 25 km radius, workshop filter; about ${candidates} branches ranked per search`,
    ],
    samples: result.samples,
  };
}

// ---------------------------------------------------------------------------------------------
// 2a. Service request creation at a steady rate (write latency)
// ---------------------------------------------------------------------------------------------

/** One service request near a random point, matched to nearby providers. */
const createRequest = (api: Api, token: string, clientRequestId: string) => {
  const { lng, lat } = randomPoint();
  return api.call("POST", "/v1/me/service-requests", {
    token,
    body: {
      clientRequestId,
      category: "workshop",
      vehicle: { vehicleType: "car", registration: "PF 12-34" },
      location: { lng, lat },
      description: "Brakes squeal when stopping at low speed.",
      target: { mode: "match", radiusKm: 25 },
    },
  });
};

export async function requestCreateScenario(
  api: Api,
  db: pg.Client,
  emulator: string,
  options: { users: number; perUser: number; concurrency: number },
): Promise<ScenarioResult> {
  const users = await testUsers(api, emulator, "perf-steady", options.users);
  // Lift the daily quota for these users (the per-user rate limit, 30 an hour, still applies,
  // so each user sends fewer than that).
  await db.query(
    `INSERT INTO quota_overrides (subject_type, user_id, key, limit_value, reason, created_by)
       SELECT 'user', u, 'service_requests.daily', NULL, 'load test', u FROM unnest($1::uuid[]) u`,
    [users.map((u) => u.id)],
  );
  const result = await runLoad(
    async (i) => {
      const user = users[i % users.length];
      if (!user) return;
      const reply = await createRequest(api, user.token, randomUUID());
      if (reply.status !== 201)
        throw new Error(`${String(reply.status)} ${JSON.stringify(reply.body).slice(0, 200)}`);
    },
    { concurrency: options.concurrency, total: options.users * options.perUser },
  );
  return {
    key: "requestCreate",
    summary: summarize(result.latencies, result.errors, result.windowMs),
    checks: [],
    notes: [
      `${String(options.concurrency)} requests in flight, ${String(options.users * options.perUser)} service requests from ${String(options.users)} users, each matched against nearby providers`,
    ],
    samples: result.samples,
  };
}

// ---------------------------------------------------------------------------------------------
// 2b. Quota concurrency: many simultaneous requests may never exceed the daily limit
// ---------------------------------------------------------------------------------------------

export async function quotaScenario(
  api: Api,
  emulator: string,
  options: { users: number; burst: number; dailyLimit: number },
): Promise<ScenarioResult> {
  const users = await testUsers(api, emulator, "perf-quota", options.users);
  const latencies: number[] = [];
  let unexpected = 0;
  let retries = 0;
  const statuses = new Map<string, number>();
  const samples: string[] = [];
  const perUser: number[] = [];
  const started = performance.now();
  await Promise.all(
    users.map(async (user) => {
      const outcomes = await Promise.all(
        Array.from({ length: options.burst }, async () => {
          // Like a real client: retry 503 overloaded after Retry-After with the same
          // clientRequestId, so a retry never consumes quota twice.
          const clientRequestId = randomUUID();
          const t0 = performance.now();
          let reply: Reply = { status: 0, body: null, retryAfter: undefined };
          for (let attempt = 1; attempt <= 6; attempt += 1) {
            reply = await createRequest(api, user.token, clientRequestId);
            const label = `${String(reply.status)} ${reasonOf(reply) ?? ""}`.trim();
            statuses.set(label, (statuses.get(label) ?? 0) + 1);
            if (reply.status !== 503 || reasonOf(reply) !== "overloaded") break;
            retries += 1;
            await sleep(((reply.retryAfter ?? 1) + Math.random()) * 1000);
          }
          const ms = performance.now() - t0;
          // A quota refusal is a correct answer, not an error.
          if (
            reply.status === 201 ||
            (reply.status === 403 && reasonOf(reply) === "quota_exceeded")
          )
            latencies.push(ms);
          else {
            unexpected += 1;
            if (samples.length < 5)
              samples.push(`${String(reply.status)} ${JSON.stringify(reply.body).slice(0, 200)}`);
          }
          return reply.status === 201;
        }),
      );
      perUser.push(outcomes.filter(Boolean).length);
    }),
  );
  const summary = summarize(latencies, unexpected, performance.now() - started);
  const over = perUser.filter((n) => n > options.dailyLimit).length;
  const under = perUser.filter((n) => n < options.dailyLimit).length;
  return {
    key: "requestBurst",
    summary,
    checks: [
      check(
        "no user got more requests than the daily limit",
        over === 0,
        `${String(over)} of ${String(users.length)} users over the limit`,
      ),
      check(
        "every user got exactly the daily limit",
        under === 0,
        `${String(under)} of ${String(users.length)} users under the limit`,
      ),
    ],
    notes: [
      `${String(options.users)} users each sent ${String(options.burst)} requests at the same moment (daily limit ${String(options.dailyLimit)}); quota refusals (403 quota_exceeded) count as correct answers; latency includes retries`,
      `responses: ${[...statuses].map(([label, n]) => `${label} × ${String(n)}`).join(", ")}; ${String(retries)} retries after 503 overloaded`,
    ],
    samples,
  };
}

// ---------------------------------------------------------------------------------------------
// 3. Messaging fan-out: one group conversation, every member subscribed over WebSocket
// ---------------------------------------------------------------------------------------------

/** The parts of a WebSocket the harness uses (Node's built-in client and the ws package). */
interface MiniSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

/** Which client library a subscriber uses (browsers and React Native have their own). */
type ClientKind = "builtin" | "ws";

interface Subscriber {
  socket: MiniSocket;
  client: ClientKind;
  arrivals: Map<string, number>;
  /** Frames other than messages after subscribing (errors, unsubscribed...), for diagnosis. */
  other: string[];
  closed: boolean;
}

async function subscribe(
  wsUrl: string,
  token: string,
  conversationId: string,
  after = 0,
  client: ClientKind = "builtin",
): Promise<Subscriber> {
  const socket = (client === "ws"
    ? new NodeWebSocket(wsUrl)
    : new WebSocket(wsUrl)) as unknown as MiniSocket;
  const arrivals = new Map<string, number>();
  const other: string[] = [];
  const subscriber: Subscriber = { socket, client, arrivals, other, closed: false };
  socket.addEventListener("close", () => {
    subscriber.closed = true;
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("socket did not become ready"));
    }, 15_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "auth", token }));
    });
    socket.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as {
        type: string;
        message?: { id: string };
      };
      if (frame.type === "ready")
        socket.send(JSON.stringify({ type: "subscribe", conversationId, after }));
      if (frame.type === "subscribed") {
        clearTimeout(timer);
        resolve();
      }
      // Other members never see clientMessageId (only the sender does), so match on the id.
      if (frame.type === "message" && frame.message?.id) {
        if (!arrivals.has(frame.message.id)) arrivals.set(frame.message.id, performance.now());
      } else if (!["ready", "subscribed", "pong"].includes(frame.type) && other.length < 5) {
        other.push(JSON.stringify(frame).slice(0, 160));
      }
    });
    socket.addEventListener("error", () => {
      reject(new Error("socket error"));
    });
  });
  return subscriber;
}

export async function messagingScenario(
  api: Api,
  db: pg.Client,
  emulator: string,
  options: { members: number; senders: number; messagesPerSender: number },
): Promise<ScenarioResult[]> {
  const [owner] = await testUsers(api, emulator, "perf-group-owner", 1);
  if (!owner) throw new Error("no owner");
  const members = await testUsers(api, emulator, "perf-group-member", options.members);
  // Groups need an established account (anti-spam); age the owner instead of waiting.
  await db.query("UPDATE users SET created_at = now() - interval '60 days' WHERE id = $1", [
    owner.id,
  ]);
  const group = (await api.expect("POST", "/v1/groups", 201, {
    token: owner.token,
    body: { name: "Perf Gauteng drivers", kind: "region", locationLabel: "Gauteng" },
  })) as { id: string };
  await db.query(
    `INSERT INTO community_group_members
       SELECT (jsonb_populate_record(NULL::community_group_members, to_jsonb(m) ||
         jsonb_build_object('id', gen_random_uuid(), 'user_id', u, 'role', 'member', 'status', 'active'))).*
       FROM community_group_members m CROSS JOIN unnest($2::uuid[]) u
       WHERE m.group_id = $1 AND m.user_id = $3`,
    [group.id, members.map((m) => m.id), owner.id],
  );
  const conversation = (await api.expect("POST", "/v1/conversations/group", [200, 201], {
    token: owner.token,
    body: { groupId: group.id },
  })) as { id: string };

  const wsUrl = `${api.baseUrl.replace(/^http/, "ws")}/v1/realtime`;
  const subscribers: Subscriber[] = [];
  for (let i = 0; i < members.length; i += 10) {
    subscribers.push(
      ...(await Promise.all(
        members
          .slice(i, i + 10)
          // Half on Node's built-in client, half on the ws package, to tell client quirks apart.
          .map((m, j) =>
            subscribe(wsUrl, m.token, conversation.id, 0, (i + j) % 2 === 0 ? "builtin" : "ws"),
          ),
      )),
    );
  }

  const sent = new Map<string, { at: number; sender: TestUser; seq: number }>();
  const senders = [owner, ...members.slice(0, options.senders - 1)];
  const subscribedAt = performance.now();
  let sendStart = 0;
  const sendResult = await runLoad(
    async (i) => {
      if (sendStart === 0) sendStart = performance.now();
      const sender = senders[i % senders.length];
      if (!sender) return;
      const at = performance.now();
      const message = (await api.expect(
        "POST",
        `/v1/conversations/${conversation.id}/messages`,
        201,
        {
          token: sender.token,
          body: { clientMessageId: randomUUID(), body: `Perf message ${String(i)}` },
        },
      )) as { id: string; seq: number };
      sent.set(message.id, { at, sender, seq: message.seq });
    },
    { concurrency: options.senders, total: options.senders * options.messagesPerSender },
  );

  // Wait for deliveries to settle.
  // Every subscriber gets every message except its own.
  const expected = subscribers.reduce(
    (n, _s, index) =>
      n + [...sent.values()].filter((info) => info.sender.id !== members[index]?.id).length,
    0,
  );
  const deadline = performance.now() + 15_000;
  const deliveries = () => subscribers.reduce((n, s) => n + s.arrivals.size, 0);
  while (deliveries() < expected && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const delivery: number[] = [];
  let missing = 0;
  const missedBySeq = new Map<number, number>();
  const missedByClient = new Map<ClientKind, number>();
  subscribers.forEach((subscriber, index) => {
    const self = members[index];
    for (const [id, info] of sent) {
      if (info.sender.id === self?.id) continue;
      const arrived = subscriber.arrivals.get(id);
      if (arrived === undefined) {
        missing += 1;
        missedBySeq.set(info.seq, (missedBySeq.get(info.seq) ?? 0) + 1);
        missedByClient.set(subscriber.client, (missedByClient.get(subscriber.client) ?? 0) + 1);
      } else delivery.push(arrived - info.at);
    }
  });
  const diagnosis = [
    `missed by client: ${[...missedByClient].map(([k, n]) => `${k} ${String(n)}`).join(", ")}`,
    ...[...missedBySeq]
      .sort((a, b) => a[0] - b[0])
      .slice(0, 10)
      .map(([seq, n]) => `seq ${String(seq)} missed by ${String(n)} subscribers`),
    ...(subscribers.some((s) => s.closed)
      ? [`${String(subscribers.filter((s) => s.closed).length)} sockets closed early`]
      : []),
    ...subscribers
      .flatMap((s) => s.other)
      .slice(0, 5)
      .map((f) => `unexpected frame: ${f}`),
    `seqs sent: ${String(Math.min(...[...sent.values()].map((v) => v.seq)))}–${String(Math.max(...[...sent.values()].map((v) => v.seq)))}`,
  ];
  // Evidence for a miss: is the message stored, and does a fresh subscription replay it?
  const firstMissed = Math.min(...missedBySeq.keys());
  const witness = members.find((m, index) => {
    const id = [...sent].find(([, info]) => info.seq === firstMissed)?.[0];
    return (
      id !== undefined && !subscribers[index]?.arrivals.has(id) && m.id !== sent.get(id)?.sender.id
    );
  });
  if (missing > 0 && witness) {
    const page = (await api.call(
      "GET",
      `/v1/conversations/${conversation.id}/messages?after=${String(firstMissed - 1)}`,
      { token: witness.token },
    )) as { status: number; body: { items?: { seq: number; status: string }[] } };
    diagnosis.push(
      `REST after ${String(firstMissed - 1)}: ${String(page.status)} ${JSON.stringify(page.body.items?.map((m) => [m.seq, m.status]) ?? page.body).slice(0, 160)}`,
    );
    // Does one more message push the missed one out (something holding the last message)?
    const sentinelAt = performance.now();
    const sentinel = (await api.expect(
      "POST",
      `/v1/conversations/${conversation.id}/messages`,
      201,
      {
        token: owner.token,
        body: { clientMessageId: randomUUID(), body: "Perf sentinel" },
      },
    )) as { id: string };
    await sleep(2_000);
    const timing = subscribers
      .map((sub) => ({
        missed: sub.arrivals.get([...sent].find(([, info]) => info.seq === firstMissed)?.[0] ?? ""),
        sentinel: sub.arrivals.get(sentinel.id),
      }))
      .filter((x) => x.missed !== undefined && x.sentinel !== undefined)
      .map((x) => Math.round((x.missed ?? 0) - sentinelAt));
    diagnosis.push(
      `missed message arrived ${String(Math.min(...timing))}–${String(Math.max(...timing))} ms after the extra message was sent (about ${String(GAP_HINT_MS)} = gap fill); first send was ${String(Math.round(sendStart - subscribedAt))} ms after subscribing`,
    );
    const missedId = [...sent].find(([, info]) => info.seq === firstMissed)?.[0] ?? "";
    diagnosis.push(
      `after one more message, seq ${String(firstMissed)} reached ${String(subscribers.filter((sub) => sub.arrivals.has(missedId)).length)} of ${String(subscribers.length)} sockets; ${String(subscribers.filter((sub) => sub.arrivals.has(sentinel.id)).length)} sockets saw the sentinel`,
    );
    const again = await subscribe(wsUrl, witness.token, conversation.id, firstMissed - 1);
    diagnosis.push(
      `resubscribe after ${String(firstMissed - 1)} replayed ${String(again.arrivals.size)} messages`,
    );
    again.socket.close();
  }
  for (const s of subscribers) s.socket.close();

  return [
    {
      key: "messageSend",
      summary: summarize(sendResult.latencies, sendResult.errors, sendResult.windowMs),
      checks: [],
      notes: [
        `${String(options.senders)} members sending at once, ${String(sent.size)} messages in one group conversation`,
      ],
      samples: sendResult.samples,
    },
    {
      key: "messageDelivery",
      summary: summarize(delivery, missing, sendResult.windowMs),
      checks: [
        check(
          "every subscribed member received every message",
          missing === 0,
          `${String(missing)} deliveries missing`,
        ),
      ],
      notes: [
        `${String(subscribers.length)} members subscribed over WebSocket; latency from send start to arrival`,
      ],
      samples: missing > 0 ? diagnosis : [],
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// 4. Emergency fan-out: many alerts at once, each to several trusted contacts
// ---------------------------------------------------------------------------------------------

export async function emergencyScenario(
  api: Api,
  db: pg.Client,
  emulator: string,
  options: { owners: number; contactsEach: number },
): Promise<ScenarioResult> {
  const owners = await testUsers(api, emulator, "perf-alert-owner", options.owners);
  const contacts = await testUsers(
    api,
    emulator,
    "perf-alert-contact",
    options.owners * options.contactsEach,
  );
  await Promise.all(
    contacts.map((c, i) =>
      api.expect("PUT", "/v1/me/devices", [200, 204], {
        token: c.token,
        body: { fid: `perf_fid_${String(i).padStart(12, "0")}`, platform: "android" },
      }),
    ),
  );
  for (const [index, owner] of owners.entries()) {
    const mine = contacts.slice(index * options.contactsEach, (index + 1) * options.contactsEach);
    for (const contact of mine) {
      const [a, b] = owner.id < contact.id ? [owner.id, contact.id] : [contact.id, owner.id];
      await db.query(
        "INSERT INTO friendships (user_a_id, user_b_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [a, b],
      );
      const invite = (await api.expect("POST", "/v1/me/trusted-contacts", 201, {
        token: owner.token,
        body: { userId: contact.id, priority: "primary" },
      })) as { id: string };
      await api.expect("POST", `/v1/me/trusted-contacts/${invite.id}/accept`, 200, {
        token: contact.token,
      });
    }
  }

  const raised = await Promise.all(
    owners.map(async (owner) => {
      const body = (await api.expect("POST", "/v1/emergency/incidents", 201, {
        token: owner.token,
        body: {
          clientIncidentId: randomUUID(),
          category: "breakdown",
          shareLocation: false,
          notifyNearbyProviders: false,
        },
      })) as { id: string };
      return body.id;
    }),
  );

  const expected = options.owners * options.contactsEach;
  const deadline = Date.now() + 60_000;
  // extract() returns numeric, which node-postgres reads as a string.
  let rows: { ms: string }[] = [];
  while (Date.now() < deadline) {
    const result = await db.query<{ ms: string }>(
      `SELECT extract(epoch FROM (d.sent_at - i.created_at)) * 1000 AS ms
         FROM incident_deliveries d JOIN emergency_incidents i ON i.id = d.incident_id
        WHERE d.incident_id = ANY($1::uuid[]) AND d.purpose = 'alert' AND d.channel = 'push' AND d.status = 'sent'`,
      [raised],
    );
    rows = result.rows;
    if (rows.length >= expected) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const latencies = rows.map((r) => Number(r.ms));
  return {
    key: "emergencyFanout",
    summary: summarize(latencies, Math.max(0, expected - rows.length), 60_000),
    checks: [
      check(
        "every trusted contact's push was sent",
        rows.length >= expected,
        `${String(rows.length)} of ${String(expected)} sent`,
      ),
    ],
    notes: [
      `${String(options.owners)} alerts raised at the same moment, ${String(options.contactsEach)} trusted contacts each; worker tick 200 ms; latency from alert creation to push sent (database timestamps)`,
    ],
    samples: [],
  };
}
