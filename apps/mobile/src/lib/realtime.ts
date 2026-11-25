import {
  type ClientFrame,
  type MessageDto,
  REALTIME_CLOSE,
  type ServerFrame,
} from "@fleettrust/types";

/**
 * Realtime chat over `/v1/realtime` (ADR-0024). The ID token goes in the first frame, never
 * in the URL. The client keeps the highest `seq` per conversation, so after any reconnect it
 * subscribes with `after` and the server replays what was missed, in order. Duplicates
 * (replay overlapping live delivery) are dropped by `seq`.
 *
 * Reconnects back off from 1 s to 30 s, pause while the app is in the background or offline,
 * and stop for good when the account is suspended (close code 4403).
 */

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
}

export type RealtimeStatus = "idle" | "connecting" | "live" | "waiting" | "stopped";

export interface RealtimeOptions {
  url: string;
  token: () => Promise<string | null>;
  createSocket: (url: string) => SocketLike;
  onMessage: (conversationId: string, message: MessageDto) => void;
  onMessageUpdated?: (conversationId: string, message: MessageDto) => void;
  /** More than the replay limit was missed: page the rest over REST from `nextAfter`. */
  onTruncated?: (conversationId: string, nextAfter: number) => void;
  onStatus?: (status: RealtimeStatus) => void;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

export class RealtimeClient {
  private socket: SocketLike | null = null;
  private readonly lastSeq = new Map<string, number>();
  private attempt = 0;
  private timer: unknown = null;
  private online = true;
  private foreground = true;
  private stopped = false;
  private ready = false;
  private status: RealtimeStatus = "idle";
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: RealtimeOptions) {
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer =
      options.clearTimer ??
      ((handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      });
  }

  /** Follow a conversation from `after` (the highest seq already shown). */
  watch(conversationId: string, after: number): () => void {
    const known = this.lastSeq.get(conversationId) ?? 0;
    this.lastSeq.set(conversationId, Math.max(known, after));
    if (this.socket && this.ready) {
      this.sendFrame({
        type: "subscribe",
        conversationId,
        after: this.lastSeq.get(conversationId) ?? 0,
      });
    } else {
      this.connect();
    }
    return () => {
      this.lastSeq.delete(conversationId);
      if (this.socket && this.ready) this.sendFrame({ type: "unsubscribe", conversationId });
      if (this.lastSeq.size === 0) this.disconnect();
    };
  }

  setOnline(online: boolean): void {
    this.online = online;
    if (online) this.connect();
    else this.disconnect("waiting");
  }

  setForeground(foreground: boolean): void {
    this.foreground = foreground;
    if (foreground) this.connect();
    else this.disconnect("waiting");
  }

  close(): void {
    this.stopped = true;
    this.disconnect("stopped");
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus?.(status);
  }

  private canConnect(): boolean {
    return !this.stopped && this.online && this.foreground && this.lastSeq.size > 0;
  }

  private connect(): void {
    if (this.socket || this.timer !== null || !this.canConnect()) return;
    this.setStatus("connecting");
    const socket = this.options.createSocket(this.options.url);
    this.socket = socket;
    this.ready = false;
    socket.onopen = () => {
      void this.options.token().then((token) => {
        if (this.socket !== socket) return;
        if (!token) {
          this.stopped = true;
          this.disconnect("stopped");
          return;
        }
        this.sendFrame({ type: "auth", token });
      });
    };
    socket.onmessage = (event) => {
      if (this.socket === socket) this.handle(event.data);
    };
    socket.onerror = () => undefined;
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.ready = false;
      if (event.code === REALTIME_CLOSE.forbidden) {
        this.stopped = true;
        this.setStatus("stopped");
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.canConnect()) {
      this.setStatus(this.stopped ? "stopped" : "waiting");
      return;
    }
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 30_000;
    this.attempt += 1;
    this.setStatus("waiting");
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }

  private disconnect(status: RealtimeStatus = "idle"): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    socket?.close(1000, "client closing");
    this.setStatus(status);
  }

  private sendFrame(frame: ClientFrame): void {
    this.socket?.send(JSON.stringify(frame));
  }

  private handle(data: unknown): void {
    if (typeof data !== "string") return;
    let frame: ServerFrame;
    try {
      frame = JSON.parse(data) as ServerFrame;
    } catch {
      return;
    }
    switch (frame.type) {
      case "ready":
        this.ready = true;
        this.attempt = 0;
        this.setStatus("live");
        for (const [conversationId, after] of this.lastSeq) {
          this.sendFrame({ type: "subscribe", conversationId, after });
        }
        return;
      case "message": {
        const known = this.lastSeq.get(frame.conversationId);
        if (known === undefined || frame.message.seq <= known) return;
        this.lastSeq.set(frame.conversationId, frame.message.seq);
        this.options.onMessage(frame.conversationId, frame.message);
        return;
      }
      case "message_updated":
        this.options.onMessageUpdated?.(frame.conversationId, frame.message);
        return;
      case "replay_truncated":
        this.options.onTruncated?.(frame.conversationId, frame.nextAfter);
        return;
      default:
        return;
    }
  }
}
