import { describe, expect, it } from "vitest";

import {
  emailLinkSettings,
  type KeyValueStorage,
  normaliseEmail,
  PENDING_EMAIL_KEY,
  rememberPendingEmail,
  takePendingEmail,
} from "./email-link";

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

const throwingStorage: KeyValueStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("emailLinkSettings", () => {
  it("returns to /auth/finish on the current origin", () => {
    expect(emailLinkSettings("https://app.fleettrust.example")).toEqual({
      url: "https://app.fleettrust.example/auth/finish",
      handleCodeInApp: true,
    });
    expect(emailLinkSettings("http://localhost:3000").url).toBe(
      "http://localhost:3000/auth/finish",
    );
  });

  it("refuses plain-HTTP links outside localhost (they could be intercepted)", () => {
    expect(() => emailLinkSettings("http://staging.fleettrust.example")).toThrow(/HTTPS/);
  });
});

describe("normaliseEmail", () => {
  it.each([
    ["  Driver@Example.COM ", "driver@example.com"],
    ["a@b.co", "a@b.co"],
  ])("accepts %s", (input, expected) => {
    expect(normaliseEmail(input)).toBe(expected);
  });

  it.each(["", "not-an-email", "a@b", "a b@c.com", `${"x".repeat(250)}@e.com`])(
    "rejects %s",
    (input) => {
      expect(normaliseEmail(input)).toBeUndefined();
    },
  );
});

describe("pending email", () => {
  it("is remembered once and cleared when used", () => {
    const storage = memoryStorage();
    rememberPendingEmail(storage, "driver@example.com");
    expect(storage.data.get(PENDING_EMAIL_KEY)).toBe("driver@example.com");
    expect(takePendingEmail(storage)).toBe("driver@example.com");
    expect(takePendingEmail(storage)).toBeUndefined();
  });

  it("degrades gracefully when storage is unavailable (private browsing)", () => {
    expect(() => {
      rememberPendingEmail(throwingStorage, "driver@example.com");
    }).not.toThrow();
    expect(takePendingEmail(throwingStorage)).toBeUndefined();
  });
});
