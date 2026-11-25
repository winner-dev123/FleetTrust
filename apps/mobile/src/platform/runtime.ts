import { type ApiClient, createApiClient } from "@fleettrust/sdk";

import { mobileEnv } from "../env";
import type { SocketLike } from "../lib/realtime";
import { createNativePlatform } from "./native";
import type { Platform } from "./types";

/** Everything the app talks to: device ports, the API client and the socket factory. */
export interface Runtime {
  platform: Platform;
  api: ApiClient;
  createSocket: (url: string) => SocketLike;
}

/** Wraps React Native's WebSocket in the small interface the realtime client uses. */
function webSocket(url: string): SocketLike {
  const ws = new WebSocket(url);
  const socket: SocketLike = {
    send: (data) => {
      ws.send(data);
    },
    close: (code, reason) => {
      ws.close(code, reason);
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.onopen = () => socket.onopen?.();
  ws.onmessage = (event) => socket.onmessage?.({ data: event.data });
  ws.onclose = (event) => socket.onclose?.({ code: event.code });
  ws.onerror = () => socket.onerror?.();
  return socket;
}

export function createRuntime(
  platform: Platform,
  overrides: Partial<Omit<Runtime, "platform">> = {},
): Runtime {
  return {
    platform,
    api:
      overrides.api ??
      createApiClient({
        baseUrl: mobileEnv.apiUrl,
        getIdToken: () => platform.auth.idToken(),
        getAppCheckToken: () => platform.device.appCheckToken(),
      }),
    createSocket: overrides.createSocket ?? webSocket,
  };
}

let current: Runtime | null = null;

/** The app's runtime: native adapters unless a test installed fakes with `setRuntime`. */
export function getRuntime(): Runtime {
  current ??= createRuntime(createNativePlatform());
  return current;
}

export function setRuntime(runtime: Runtime | null): void {
  current = runtime;
}
