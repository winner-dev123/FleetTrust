import { describe, expect, it } from "vitest";

import { rememberReturnPath, safeReturnPath, takeReturnPath } from "./return-path";

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  key() {
    return null;
  }
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

describe("safeReturnPath (open-redirect guard)", () => {
  it("keeps same-site paths", () => {
    expect(safeReturnPath("/app/requests/123?tab=quotes")).toBe("/app/requests/123?tab=quotes");
  });

  it.each([
    "https://evil.example/app",
    "//evil.example/app",
    "/\\evil.example",
    "javascript:alert(1)",
    "/app\nSet-Cookie: x",
    "/sign-in",
    "/auth/finish",
    "",
    null,
    `/${"a".repeat(600)}`,
  ])("rejects %s", (value) => {
    expect(safeReturnPath(value)).toBeNull();
  });

  it("is read once", () => {
    const storage = new MemoryStorage();
    rememberReturnPath(storage, "/app/emergency");
    expect(takeReturnPath(storage)).toBe("/app/emergency");
    expect(takeReturnPath(storage)).toBeNull();
    rememberReturnPath(storage, "//evil.example");
    expect(takeReturnPath(storage)).toBeNull();
  });
});
