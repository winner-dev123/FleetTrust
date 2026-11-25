import { describe, expect, it } from "@jest/globals";

import { FakeApi, fakeRuntime } from "../../test/fake-api";
import { FakeDevice } from "../../test/fake-platform";
import { pushTarget } from "../state/push-listener";
import { locationAdvice, pushAdvice } from "./permissions";
import { enablePush, PUSH_FID_KEY, registerPush, unregisterPush } from "./push";

function setup() {
  const device = new FakeDevice();
  const api = new FakeApi();
  device.signIn();
  const runtime = fakeRuntime(device, api);
  return { device, api, runtime };
}

describe("push registration", () => {
  it("registers the installation ID only when notifications are allowed", async () => {
    const { device, api, runtime } = setup();
    expect(await registerPush(device.platform, runtime.api)).toBe("no-permission");
    expect(api.callsTo("PUT", "/v1/me/devices")).toHaveLength(0);
    // Registration never shows the OS prompt by itself.
    expect(device.pushPrompts).toBe(0);

    device.pushPermission = "granted";
    expect(await registerPush(device.platform, runtime.api)).toBe("registered");
    expect(api.callsTo("PUT", "/v1/me/devices")[0]).toMatchObject({
      body: { fid: device.fid, platform: "android" },
      authorized: true,
    });
    expect(device.store.get(PUSH_FID_KEY)).toBe(device.fid);
  });

  it("asks once, and respects a refusal", async () => {
    const { device, api, runtime } = setup();
    device.pushPromptAnswer = "denied";
    expect(await enablePush(device.platform, runtime.api)).toEqual({
      permission: "denied",
      registration: "no-permission",
    });
    expect(await enablePush(device.platform, runtime.api)).toEqual({
      permission: "denied",
      registration: "no-permission",
    });
    expect(api.callsTo("PUT", "/v1/me/devices")).toHaveLength(0);
  });

  it("unregisters before sign-out, and never blocks sign-out when offline", async () => {
    const { device, api, runtime } = setup();
    device.pushPermission = "granted";
    await registerPush(device.platform, runtime.api);
    await unregisterPush(device.platform, runtime.api);
    expect(api.callsTo("POST", "/v1/me/devices/unregister")[0]?.body).toEqual({ fid: device.fid });
    expect(device.store.has(PUSH_FID_KEY)).toBe(false);

    await registerPush(device.platform, runtime.api);
    api.offline = true;
    await expect(unregisterPush(device.platform, runtime.api)).resolves.toBeUndefined();
    expect(device.store.has(PUSH_FID_KEY)).toBe(false);
  });

  it("reports a failed registration without throwing (the inbox still records everything)", async () => {
    const { device, api, runtime } = setup();
    device.pushPermission = "granted";
    api.offline = true;
    expect(await registerPush(device.platform, runtime.api)).toBe("failed");
  });
});

describe("notification targets", () => {
  it("opens the record a push is about", () => {
    expect(pushTarget({ requestId: "r1" })).toBe("/requests/r1");
    expect(pushTarget({ conversationId: "c1" })).toBe("/messages/c1");
    expect(pushTarget({ incidentId: "i1" })).toBe("/emergency/i1");
    expect(pushTarget({ appealId: "a1" })).toBe("/account");
  });

  it("falls back to the notifications list for screens the app doesn't have", () => {
    expect(pushTarget({ vehicleId: "v1" })).toBe("/notifications");
    expect(pushTarget({ jobId: "j1" })).toBe("/notifications");
    expect(pushTarget({})).toBe("/notifications");
  });
});

describe("permission wording", () => {
  it("always offers a way forward without location", () => {
    expect(locationAdvice("undetermined")).toMatchObject({ action: "request" });
    expect(locationAdvice("denied").message).toMatch(/Type a place/);
    expect(locationAdvice("blocked")).toMatchObject({
      action: "settings",
      actionLabel: "Open Settings",
    });
    expect(locationAdvice("blocked").message).toMatch(/Type a place/);
  });

  it("sends people to Settings once notifications were refused", () => {
    expect(pushAdvice("undetermined").action).toBe("request");
    expect(pushAdvice("denied").action).toBe("settings");
    expect(pushAdvice("granted").action).toBeNull();
  });
});
