import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import type { User } from "@fleettrust/db";
import {
  type ClientFrame,
  clientFrameSchema,
  REALTIME_CLOSE,
  type ServerFrame,
} from "@fleettrust/types";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { type RawData, WebSocket, WebSocketServer } from "ws";

import { API_ENV } from "../../config/config.module.js";
import type { ApiEnv } from "../../config/env.js";
import { REALTIME_BUS, type RealtimeBus } from "../../platform/realtime/index.js";
import { AUTH_VERIFIER, type AuthVerifier, UsersService } from "../identity/index.js";
import {
  type ConversationAccess,
  MessagingService,
  type RawMessage,
  toMessageDto,
} from "./messaging.service.js";

export const REALTIME_PATH = "/v1/realtime";
const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;
/** Access is re-checked on delivery when the last check is older than this. */
const ACCESS_TTL_MS = 30_000;
const MAX_SUBSCRIPTIONS = 100;
const MAX_FRAMES_PER_10S = 200;

interface Subscription {
  access: ConversationAccess;
  checkedAt: number;
  blocked: Set<string>;
  /** Highest seq delivered: live events at or below it are duplicates of the replay. */
  lastSeq: number;
  /** Live events that arrive while the replay is running. */
  buffer: unknown[] | null;
  unsubscribe: () => Promise<void>;
}

interface Connection {
  ws: WebSocket;
  user: User | null;
  readReceipts: boolean;
  subscriptions: Map<string, Subscription>;
  unsubscribeUser: (() => Promise<void>) | null;
  alive: boolean;
  frames: number;
  windowStart: number;
}

/**
 * WebSocket delivery (ADR-0024) at `/v1/realtime`, attached to the API's HTTP server.
 * - The first frame must be `auth` with a Firebase ID token (never in the URL, so it can't leak
 *   into logs); anything else, or nothing within 10 s, closes the socket with 4401.
 * - `subscribe` checks conversation access, replays messages after the client's cursor, then
 *   streams live ones; access is re-checked during delivery, so removed members stop receiving.
 * - Fan-out across instances goes through the realtime bus (Redis pub/sub when deployed).
 */
@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("RealtimeGateway");
  private wss: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly connections = new Set<Connection>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(AUTH_VERIFIER) private readonly verifier: AuthVerifier,
    private readonly users: UsersService,
    private readonly messaging: MessagingService,
    @Inject(REALTIME_BUS) private readonly bus: RealtimeBus,
  ) {}

  onApplicationBootstrap(): void {
    // The worker role serves no clients.
    if (this.env.APP_ROLE !== "api") return;
    const server = this.adapterHost.httpAdapter.getHttpServer() as {
      on(
        event: "upgrade",
        listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
      ): void;
    };
    const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    this.wss = wss;
    server.on("upgrade", (req, socket, head) => {
      const path = (req.url ?? "").split("?")[0];
      if (path !== REALTIME_PATH) {
        socket.destroy();
        return;
      }
      // Browsers send Origin; refuse other sites (cross-site WebSocket hijacking).
      const origin = req.headers.origin;
      if (
        origin !== undefined &&
        this.env.CORS_ORIGINS.length > 0 &&
        !this.env.CORS_ORIGINS.includes(origin)
      ) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        this.connect(ws);
      });
    });
    this.heartbeat = setInterval(() => {
      for (const c of this.connections) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        c.ws.ping();
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const c of this.connections) c.ws.close(1001, "server shutting down");
    await Promise.all([...this.connections].map((c) => this.cleanup(c)));
    this.wss?.close();
  }

  private send(c: Connection, frame: ServerFrame): void {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(frame));
  }

  private connect(ws: WebSocket): void {
    const c: Connection = {
      ws,
      user: null,
      readReceipts: true,
      subscriptions: new Map(),
      unsubscribeUser: null,
      alive: true,
      frames: 0,
      windowStart: Date.now(),
    };
    this.connections.add(c);
    const timer = setTimeout(() => {
      if (!c.user) ws.close(REALTIME_CLOSE.unauthenticated, "authentication required");
    }, AUTH_TIMEOUT_MS);
    ws.on("pong", () => {
      c.alive = true;
    });
    ws.on("message", (data: RawData, isBinary: boolean) => {
      void this.onFrame(c, data, isBinary).catch((error: unknown) => {
        this.logger.warn(`frame failed: ${(error as Error).message}`);
        this.send(c, { type: "error", code: "internal" });
      });
    });
    ws.on("close", () => {
      clearTimeout(timer);
      this.connections.delete(c);
      void this.cleanup(c);
    });
    ws.on("error", () => {
      ws.terminate();
    });
  }

  private async cleanup(c: Connection): Promise<void> {
    const subs = [...c.subscriptions.values()];
    c.subscriptions.clear();
    await Promise.all(subs.map((s) => s.unsubscribe()));
    if (c.unsubscribeUser) await c.unsubscribeUser();
    c.unsubscribeUser = null;
  }

  private async onFrame(c: Connection, data: RawData, isBinary: boolean): Promise<void> {
    const now = Date.now();
    if (now - c.windowStart > 10_000) {
      c.windowStart = now;
      c.frames = 0;
    }
    if (++c.frames > MAX_FRAMES_PER_10S) {
      c.ws.close(REALTIME_CLOSE.tooManySubscriptions, "too many frames");
      return;
    }
    let frame: ClientFrame;
    try {
      if (isBinary) throw new Error("binary");
      const text = Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Buffer.concat(data as Buffer[]).toString("utf8");
      frame = clientFrameSchema.parse(JSON.parse(text));
    } catch {
      c.ws.close(REALTIME_CLOSE.invalidFrame, "invalid frame");
      return;
    }
    if (frame.type === "auth") {
      await this.authenticate(c, frame.token);
      return;
    }
    const user = c.user;
    if (!user) {
      c.ws.close(REALTIME_CLOSE.unauthenticated, "authentication required");
      return;
    }
    switch (frame.type) {
      case "ping":
        this.send(c, { type: "pong" });
        return;
      case "subscribe":
        await this.subscribe(c, user, frame.conversationId, frame.after ?? 0);
        return;
      case "unsubscribe": {
        const sub = c.subscriptions.get(frame.conversationId);
        c.subscriptions.delete(frame.conversationId);
        if (sub) await sub.unsubscribe();
        this.send(c, {
          type: "unsubscribed",
          conversationId: frame.conversationId,
          reason: "requested",
        });
        return;
      }
      case "read":
        await this.messaging.markRead(user, frame.conversationId, frame.seq).catch(() => {
          this.send(c, { type: "error", code: "not_found", conversationId: frame.conversationId });
        });
        return;
    }
  }

  private async authenticate(c: Connection, token: string): Promise<void> {
    if (c.user) return;
    let user: User;
    try {
      const identity = await this.verifier.verifyIdToken(token, { checkRevoked: false });
      user = await this.users.findOrCreate(identity);
    } catch {
      c.ws.close(REALTIME_CLOSE.unauthenticated, "invalid token");
      return;
    }
    if (user.status !== "active") {
      c.ws.close(REALTIME_CLOSE.forbidden, "account suspended");
      return;
    }
    c.user = user;
    c.readReceipts = (await this.messaging.preferencesFor(user.id)).readReceipts;
    c.unsubscribeUser = await this.bus.subscribe(`user:${user.id}`, (payload) => {
      const frame = payload as ServerFrame;
      if (frame.type === "inbox" || frame.type === "notification") this.send(c, frame);
    });
    this.send(c, { type: "ready", userId: user.id });
  }

  private async subscribe(
    c: Connection,
    user: User,
    conversationId: string,
    after: number,
  ): Promise<void> {
    if (c.subscriptions.has(conversationId)) {
      // Re-subscribing replays again from the new cursor.
      const old = c.subscriptions.get(conversationId);
      c.subscriptions.delete(conversationId);
      if (old) await old.unsubscribe();
    }
    if (c.subscriptions.size >= MAX_SUBSCRIPTIONS) {
      this.send(c, { type: "error", code: "too_many_subscriptions", conversationId });
      return;
    }
    const access = await this.messaging.accessFor(user, conversationId);
    if (!access) {
      this.send(c, { type: "error", code: "not_found", conversationId });
      return;
    }
    const sub: Subscription = {
      access,
      checkedAt: Date.now(),
      blocked:
        access.conversation.kind === "group" ? await this.messaging.blockedFor(user.id) : new Set(),
      lastSeq: after,
      buffer: [],
      unsubscribe: () => Promise.resolve(),
    };
    c.subscriptions.set(conversationId, sub);
    // Subscribe before replaying so nothing published in between is lost; duplicates are
    // dropped by seq.
    sub.unsubscribe = await this.bus.subscribe(`conversation:${conversationId}`, (payload) => {
      if (sub.buffer !== null) sub.buffer.push(payload);
      else void this.deliver(c, user, conversationId, sub, payload);
    });
    const replay = await this.messaging.replay(access, user, after);
    for (const raw of replay.items) {
      this.send(c, {
        type: "message",
        conversationId,
        message: toMessageDto(raw, user.id),
        replay: true,
      });
      sub.lastSeq = Math.max(sub.lastSeq, raw.seq);
    }
    if (replay.more) {
      this.send(c, { type: "replay_truncated", conversationId, nextAfter: sub.lastSeq });
    }
    const buffered = sub.buffer ?? [];
    sub.buffer = null;
    this.send(c, {
      type: "subscribed",
      conversationId,
      lastSeq: Math.max(sub.lastSeq, access.conversation.lastSeq),
    });
    for (const payload of buffered) await this.deliver(c, user, conversationId, sub, payload);
  }

  /** Re-checks access when stale, then forwards one live event to this socket. */
  private async deliver(
    c: Connection,
    user: User,
    conversationId: string,
    sub: Subscription,
    payload: unknown,
  ): Promise<void> {
    if (c.subscriptions.get(conversationId) !== sub) return;
    if (Date.now() - sub.checkedAt > ACCESS_TTL_MS) {
      const access = await this.messaging.accessFor(user, conversationId);
      if (!access) {
        c.subscriptions.delete(conversationId);
        await sub.unsubscribe();
        this.send(c, { type: "unsubscribed", conversationId, reason: "access_revoked" });
        return;
      }
      sub.access = access;
      sub.checkedAt = Date.now();
      if (access.conversation.kind === "group")
        sub.blocked = await this.messaging.blockedFor(user.id);
    }
    const event = payload as
      | { type: "message"; message: RawMessage }
      | { type: "refresh"; messageId: string }
      | {
          type: "receipt";
          readerUserId: string;
          readerSide: "requester" | "provider" | null;
          seq: number;
        };
    if (event.type === "message") {
      const raw = event.message;
      if (raw.seq <= sub.lastSeq) return;
      sub.lastSeq = raw.seq;
      if (sub.blocked.has(raw.senderUserId)) return;
      this.send(c, {
        type: "message",
        conversationId,
        message: toMessageDto(raw, user.id),
        replay: false,
      });
      return;
    }
    if (event.type === "refresh") {
      const message = await this.messaging.messageFor(user, conversationId, event.messageId);
      if (message && !(message.sender.userId !== null && sub.blocked.has(message.sender.userId))) {
        this.send(c, { type: "message_updated", conversationId, message });
      }
      return;
    }
    // Receipts: only from the other side, and only when this viewer shares receipts too.
    if (!c.readReceipts || event.readerUserId === user.id) return;
    const kind = sub.access.conversation.kind;
    const fromPeer =
      (kind === "direct" && event.readerUserId === sub.access.peerUserId) ||
      (kind === "request" && event.readerSide !== null && event.readerSide !== sub.access.side);
    if (fromPeer) this.send(c, { type: "receipt", conversationId, side: "peer", seq: event.seq });
  }
}
