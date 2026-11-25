import type {
  AuthUser,
  DeviceLocation,
  EmailLinkSettings,
  LocationPermission,
  Platform,
  PushMessage,
  PushPermission,
} from "../src/platform/types";

/**
 * A controllable device for tests: sign people in and out, flip the network, answer
 * permission prompts, deliver push messages. Every port behaves like the native adapter's
 * contract (see src/platform/types.ts).
 */
export class FakeDevice {
  user: AuthUser | null = null;
  readonly sentLinks: { email: string; settings: EmailLinkSettings }[] = [];
  readonly completedLinks: { email: string; url: string }[] = [];
  validLinks = new Set<string>();

  pushPermission: PushPermission = "undetermined";
  /** What the OS prompt answers when the app asks. */
  pushPromptAnswer: PushPermission = "granted";
  pushPrompts = 0;
  fid = "fid_test_installation_0001";
  initialNotification: PushMessage | null = null;

  locationPermission: LocationPermission = "undetermined";
  locationPromptAnswer: LocationPermission = "granted";
  locationPrompts = 0;
  position: DeviceLocation | Error = { lat: -33.9249, lng: 18.4241, accuracyM: 12 };

  online = true;
  readonly store = new Map<string, string>();
  settingsOpened = 0;
  readonly externalUrls: string[] = [];
  private idCounter = 0;

  private readonly authListeners = new Set<(user: AuthUser | null) => void>();
  private readonly networkListeners = new Set<(online: boolean) => void>();
  private readonly foregroundListeners = new Set<(message: PushMessage) => void>();
  private readonly openedListeners = new Set<(message: PushMessage) => void>();

  signIn(user: AuthUser = { uid: "user-1", email: "driver@example.com" }): void {
    this.user = user;
    for (const listener of this.authListeners) listener(user);
  }

  signOutNow(): void {
    this.user = null;
    for (const listener of this.authListeners) listener(null);
  }

  setOnline(online: boolean): void {
    this.online = online;
    for (const listener of this.networkListeners) listener(online);
  }

  deliverForeground(message: PushMessage): void {
    for (const listener of this.foregroundListeners) listener(message);
  }

  tapNotification(message: PushMessage): void {
    for (const listener of this.openedListeners) listener(message);
  }

  readonly platform: Platform = {
    auth: {
      subscribe: (listener) => {
        this.authListeners.add(listener);
        listener(this.user);
        return () => {
          this.authListeners.delete(listener);
        };
      },
      idToken: () =>
        Promise.resolve(this.user ? `test-id-token-for-${this.user.uid}-0123456789` : null),
      sendSignInLink: (email, settings) => {
        this.sentLinks.push({ email, settings });
        return Promise.resolve();
      },
      isSignInLink: (url) => this.validLinks.has(url),
      completeSignInLink: (email, url) => {
        this.completedLinks.push({ email, url });
        this.signIn({ uid: "user-1", email });
        return Promise.resolve();
      },
      signOut: () => {
        this.signOutNow();
        return Promise.resolve();
      },
    },
    push: {
      permission: () => Promise.resolve(this.pushPermission),
      requestPermission: () => {
        this.pushPrompts += 1;
        // The OS shows its prompt only once; later requests return the stored answer.
        if (this.pushPermission === "undetermined") this.pushPermission = this.pushPromptAnswer;
        return Promise.resolve(this.pushPermission);
      },
      installationId: () => Promise.resolve(this.fid),
      onForegroundMessage: (listener) => {
        this.foregroundListeners.add(listener);
        return () => {
          this.foregroundListeners.delete(listener);
        };
      },
      onNotificationOpened: (listener) => {
        this.openedListeners.add(listener);
        return () => {
          this.openedListeners.delete(listener);
        };
      },
      initialNotification: () => Promise.resolve(this.initialNotification),
    },
    location: {
      permission: () => Promise.resolve(this.locationPermission),
      requestPermission: () => {
        this.locationPrompts += 1;
        if (this.locationPermission === "undetermined" || this.locationPermission === "denied") {
          this.locationPermission = this.locationPromptAnswer;
        }
        return Promise.resolve(this.locationPermission);
      },
      current: () =>
        this.position instanceof Error
          ? Promise.reject(this.position)
          : Promise.resolve(this.position),
    },
    storage: {
      get: (key) => Promise.resolve(this.store.get(key) ?? null),
      set: (key, value) => {
        this.store.set(key, value);
        return Promise.resolve();
      },
      remove: (key) => {
        this.store.delete(key);
        return Promise.resolve();
      },
      keys: () => Promise.resolve([...this.store.keys()]),
    },
    network: {
      subscribe: (listener) => {
        this.networkListeners.add(listener);
        listener(this.online);
        return () => {
          this.networkListeners.delete(listener);
        };
      },
    },
    device: {
      os: "android",
      openSettings: () => {
        this.settingsOpened += 1;
        return Promise.resolve();
      },
      openExternal: (url) => {
        this.externalUrls.push(url);
        return Promise.resolve();
      },
      appCheckToken: () => Promise.resolve(null),
      randomId: () => {
        this.idCounter += 1;
        return `0190b000-0000-7000-8000-${this.idCounter.toString(16).padStart(12, "0")}`;
      },
    },
  };
}
