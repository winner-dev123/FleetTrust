import { afterEach, describe, expect, it } from "vitest";

import {
  afterSignInPath,
  clearPendingInvitation,
  pendingInvitation,
  savePendingInvitation,
  tokenFromHash,
} from "./pending-invitation";

const token = "A".repeat(43);

class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  configurable: true,
});

afterEach(() => {
  clearPendingInvitation();
});

describe("pending invitation", () => {
  it("reads the token from the URL fragment and ignores anything malformed", () => {
    expect(tokenFromHash(`#token=${token}`)).toBe(token);
    expect(tokenFromHash("#token=short")).toBeNull();
    expect(tokenFromHash("")).toBeNull();
  });

  it("survives sign-in and steers the redirect", () => {
    expect(afterSignInPath()).toBe("/account");
    savePendingInvitation(token);
    expect(pendingInvitation()).toBe(token);
    expect(afterSignInPath()).toBe("/invitations/accept");
    clearPendingInvitation();
    expect(afterSignInPath()).toBe("/account");
  });
});
