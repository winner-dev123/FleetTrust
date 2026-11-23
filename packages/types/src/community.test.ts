import { describe, expect, it } from "vitest";

import {
  createGroupSchema,
  DEFAULT_SOCIAL_SETTINGS,
  searchGroupsQuerySchema,
  sendFriendRequestSchema,
  updateSocialSettingsSchema,
} from "./community.js";

describe("community schemas", () => {
  it("privacy defaults keep people out of search", () => {
    expect(DEFAULT_SOCIAL_SETTINGS).toEqual({
      friendRequestsFrom: "everyone",
      friendListVisibility: "friends",
      discoverable: false,
    });
    expect(updateSocialSettingsSchema.safeParse({}).success).toBe(false);
    expect(updateSocialSettingsSchema.safeParse({ friendRequestsFrom: "anyone" }).success).toBe(
      false,
    );
  });

  it("friend requests carry no message", () => {
    const userId = "0196f2a8-6b7c-7d00-9e00-1a2b3c4d5e6f";
    expect(sendFriendRequestSchema.safeParse({ userId }).success).toBe(true);
    expect(sendFriendRequestSchema.safeParse({ userId, message: "hi" }).success).toBe(false);
  });

  it("groups need a specialty or a location label to match their kind", () => {
    expect(createGroupSchema.safeParse({ name: "Tankers SA", kind: "specialty" }).success).toBe(
      false,
    );
    expect(
      createGroupSchema.safeParse({ name: "Tankers SA", kind: "specialty", specialty: "tankers" })
        .success,
    ).toBe(true);
    expect(createGroupSchema.safeParse({ name: "Karoo", kind: "region" }).success).toBe(false);
    expect(
      createGroupSchema.safeParse({ name: "Karoo", kind: "region", locationLabel: "Karoo" })
        .success,
    ).toBe(true);
    expect(
      createGroupSchema.safeParse({ name: "ab", kind: "region", locationLabel: "x" }).success,
    ).toBe(false);
  });

  it("near-me search needs both coordinates", () => {
    expect(searchGroupsQuerySchema.safeParse({ lng: "25" }).success).toBe(false);
    expect(searchGroupsQuerySchema.parse({ lng: "25", lat: "-30" })).toMatchObject({
      lng: 25,
      lat: -30,
      radiusKm: 100,
    });
  });
});
