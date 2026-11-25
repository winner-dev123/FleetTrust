/**
 * Device capabilities the app uses, as small ports (ADR-0032). The native adapters live in
 * `native.ts` (Firebase, expo-location, AsyncStorage, NetInfo); tests use `fake.ts`. Screens
 * never import a native module directly, so every flow can be tested without a device.
 */

export interface AuthUser {
  uid: string;
  email: string | null;
}

/** What Firebase needs to build an email sign-in link that opens this app. */
export interface EmailLinkSettings {
  url: string;
  handleCodeInApp: true;
  iOS: { bundleId: string };
  android: { packageName: string; installApp: boolean };
  linkDomain?: string;
}

export interface AuthPort {
  /** Calls back with the current user now and on every change. Returns an unsubscribe. */
  subscribe(listener: (user: AuthUser | null) => void): () => void;
  /** Fresh (auto-refreshed) ID token, or null when signed out. */
  idToken(): Promise<string | null>;
  sendSignInLink(email: string, settings: EmailLinkSettings): Promise<void>;
  isSignInLink(url: string): boolean;
  completeSignInLink(email: string, url: string): Promise<void>;
  signOut(): Promise<void>;
}

/** iOS can grant "provisional" (quiet) delivery; we treat it as granted. */
export type PushPermission = "granted" | "denied" | "undetermined";

/** The part of a push message the app reads. `data` holds IDs only (see the API). */
export interface PushMessage {
  title: string | null;
  body: string | null;
  data: Record<string, string>;
}

export interface PushPort {
  permission(): Promise<PushPermission>;
  requestPermission(): Promise<PushPermission>;
  /** Firebase Installation ID: the push address the API stores (ADR-0024). */
  installationId(): Promise<string>;
  /** Messages that arrive while the app is open (the OS shows nothing then). */
  onForegroundMessage(listener: (message: PushMessage) => void): () => void;
  /** The user tapped a notification while the app was in the background. */
  onNotificationOpened(listener: (message: PushMessage) => void): () => void;
  /** The notification that launched the app from a quit state, if any. */
  initialNotification(): Promise<PushMessage | null>;
}

/**
 * Foreground ("while using the app") location only; the app never asks for background
 * location. `blocked` means the OS won't show the prompt again: only Settings can change it.
 */
export type LocationPermission = "granted" | "denied" | "blocked" | "undetermined";

export interface DeviceLocation {
  lat: number;
  lng: number;
  /** Metres. iOS "approximate location" gives several kilometres. */
  accuracyM: number | null;
}

export interface LocationPort {
  permission(): Promise<LocationPermission>;
  requestPermission(): Promise<LocationPermission>;
  /** Current position; rejects if unavailable (GPS off, timeout). */
  current(): Promise<DeviceLocation>;
}

/** Small on-device key/value store (AsyncStorage). Not encrypted: never store tokens here. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
}

export interface NetworkPort {
  /** Calls back with the current state now and on every change. Returns an unsubscribe. */
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface DevicePort {
  os: "ios" | "android";
  openSettings(): Promise<void>;
  /** Opens tel:, https: and mailto: links outside the app. */
  openExternal(url: string): Promise<void>;
  appCheckToken(): Promise<string | null>;
  /** Unique ID for idempotent requests (alerts, messages). */
  randomId(): string;
}

export interface Platform {
  auth: AuthPort;
  push: PushPort;
  location: LocationPort;
  storage: KeyValueStore;
  network: NetworkPort;
  device: DevicePort;
}
