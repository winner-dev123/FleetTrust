import { describe, expect, it } from "@jest/globals";
import { z } from "zod";

import { FakeDevice } from "../../test/fake-platform";
import { clearUserData, DRAFT_TTL_MS, DraftStore, draftKey } from "./drafts";

const schema = z.object({ text: z.string() });

describe("offline drafts", () => {
  it("restores what was typed, per user", async () => {
    const device = new FakeDevice();
    const drafts = new DraftStore(device.platform.storage, () =>
      Date.parse("2026-11-24T10:00:00Z"),
    );
    await drafts.save("u1", "message", "c1", { text: "On my way" });
    expect(await drafts.load("u1", "message", "c1", schema)).toEqual({
      value: { text: "On my way" },
      savedAt: "2026-11-24T10:00:00.000Z",
    });
    expect(await drafts.load("u2", "message", "c1", schema)).toBeNull();
  });

  it("drops drafts older than 7 days and unreadable ones", async () => {
    const device = new FakeDevice();
    let now = Date.parse("2026-11-01T00:00:00Z");
    const drafts = new DraftStore(device.platform.storage, () => now);
    await drafts.save("u1", "request", "new", { text: "old" });
    now += DRAFT_TTL_MS + 1;
    expect(await drafts.load("u1", "request", "new", schema)).toBeNull();
    expect(device.store.has(draftKey("u1", "request", "new"))).toBe(false);

    device.store.set(draftKey("u1", "comment", "a1"), "{not json");
    expect(await drafts.load("u1", "comment", "a1", schema)).toBeNull();
    device.store.set(
      draftKey("u1", "comment", "a2"),
      JSON.stringify({ savedAt: new Date(now).toISOString(), value: { text: 5 } }),
    );
    expect(await drafts.load("u1", "comment", "a2", schema)).toBeNull();
  });

  it("erases only the signed-out user's drafts and queued messages", async () => {
    const device = new FakeDevice();
    const drafts = new DraftStore(device.platform.storage);
    await drafts.save("u1", "message", "c1", { text: "a" });
    await drafts.save("u2", "message", "c1", { text: "b" });
    device.store.set("ft:outbox:u1", "[]");
    device.store.set("ft:push:fid", "fid");
    expect(await clearUserData(device.platform.storage, "u1")).toBe(2);
    expect([...device.store.keys()].sort()).toEqual(["ft:draft:u2:message:c1", "ft:push:fid"]);
  });
});
