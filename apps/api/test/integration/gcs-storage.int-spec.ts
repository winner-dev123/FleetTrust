import { randomUUID } from "node:crypto";

import { Storage } from "@google-cloud/storage";
import { describe, expect, it } from "vitest";

import { GcsObjectStorage } from "../../src/platform/storage/index.js";

/**
 * The production Cloud Storage adapter against the Firebase Storage emulator (CI's
 * `local-infra` job). Covers head/read/write/delete. V4 signed URLs can't be checked here:
 * the emulator doesn't verify signatures and signing needs real credentials (ADR-0012), so
 * upload URLs are verified against the staging bucket (docs/operations/verification.md).
 */
const emulator = process.env["STORAGE_EMULATOR_HOST"];
if (process.env["REQUIRE_INTEGRATION"] === "1" && !emulator) {
  throw new Error("REQUIRE_INTEGRATION=1 but STORAGE_EMULATOR_HOST is not set");
}

describe.skipIf(!emulator)("GcsObjectStorage against the Storage emulator", () => {
  const bucket = "demo-fleettrust.appspot.com";
  const storage = new GcsObjectStorage(
    { quarantine: bucket, sensitive: bucket },
    new Storage({ projectId: "demo-fleettrust" }),
  );

  it("writes, inspects, reads and deletes objects", async () => {
    const key = `integration/${randomUUID()}`;
    const data = Buffer.from([0, 1, 2, 3, 255, 254]);
    expect(await storage.head("sensitive", key)).toBeNull();

    await storage.write("sensitive", key, data, "application/octet-stream");
    expect(await storage.head("sensitive", key)).toEqual({
      size: data.length,
      contentType: "application/octet-stream",
    });
    expect((await storage.read("sensitive", key)).equals(data)).toBe(true);

    await storage.delete("sensitive", key);
    expect(await storage.head("sensitive", key)).toBeNull();
    // Deleting again is fine (idempotent cleanup after a failed pipeline).
    await storage.delete("sensitive", key);
  });
});
