import { describe, expect, it } from "@jest/globals";
import { userEvent } from "@testing-library/react-native";
import { screen, waitFor } from "expo-router/testing-library";

import { openApp } from "../app";
import { FakeDevice } from "../fake-platform";

/**
 * Location permission states on the search screen (device-level behaviour, simulated). The
 * same states are checked by hand on real phones: docs/qa/mobile-device-test-plan.md.
 */
describe("location permission", () => {
  it("asks only when the person taps the button, then searches near them", async () => {
    const user = userEvent.setup();
    const { device, api } = await openApp("/", { signedIn: false });
    expect(
      await screen.findByText(/uses your location only while you use the app/),
    ).toBeOnTheScreen();
    expect(device.locationPrompts).toBe(0);

    await user.press(screen.getByRole("button", { name: "Use my location" }));
    expect(device.locationPrompts).toBe(1);
    expect(await screen.findByText("Where are you?: Your current location")).toBeOnTheScreen();

    await user.press(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("1. Acme Garage")).toBeOnTheScreen();
    expect(api.callsTo("GET", "/v1/search/providers")[0]?.authorized).toBe(false);
  });

  it("keeps working when the person says no: typed places still search", async () => {
    const user = userEvent.setup();
    const device = new FakeDevice();
    device.locationPromptAnswer = "denied";
    await openApp("/", { device, signedIn: false });
    await user.press(await screen.findByRole("button", { name: "Use my location" }));
    expect(await screen.findByText(/Location is off for FleetTrust/)).toBeOnTheScreen();

    await user.type(screen.getByLabelText("Or type a place"), "Woodstock");
    await user.press(screen.getByRole("button", { name: "Find place" }));
    expect(await screen.findByText("Where are you?: Woodstock, Cape Town")).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("1. Acme Garage")).toBeOnTheScreen();
  });

  it("sends people to Settings when the OS won't ask again", async () => {
    const user = userEvent.setup();
    const device = new FakeDevice();
    device.locationPermission = "blocked";
    await openApp("/", { device, signedIn: false });
    await user.press(await screen.findByRole("button", { name: "Open Settings" }));
    expect(device.settingsOpened).toBe(1);
    expect(device.locationPrompts).toBe(0);
  });

  it("says when the position is only approximate (iOS approximate location)", async () => {
    const user = userEvent.setup();
    const device = new FakeDevice();
    device.locationPermission = "granted";
    device.position = { lat: -33.9, lng: 18.4, accuracyM: 5_000 };
    await openApp("/", { device, signedIn: false });
    await user.press(await screen.findByRole("button", { name: "Use my location" }));
    expect(
      await screen.findByText(/This position is approximate \(within about 5 km\)/),
    ).toBeOnTheScreen();
  });

  it("explains a GPS failure instead of hanging", async () => {
    const user = userEvent.setup();
    const device = new FakeDevice();
    device.locationPermission = "granted";
    device.position = new Error("Location services are off");
    await openApp("/", { device, signedIn: false });
    await user.press(await screen.findByRole("button", { name: "Use my location" }));
    expect(await screen.findByText(/couldn't get your position/)).toBeOnTheScreen();
  });
});

describe("notification permission", () => {
  it("is never requested at launch; Account offers it, and a refusal leads to Settings", async () => {
    const user = userEvent.setup();
    const device = new FakeDevice();
    device.pushPromptAnswer = "denied";
    const { api } = await openApp("/account", { device });
    expect(await screen.findByText("Display name")).toBeOnTheScreen();
    expect(device.pushPrompts).toBe(0);

    await user.press(screen.getByRole("button", { name: "Turn on notifications" }));
    expect(device.pushPrompts).toBe(1);
    expect(await screen.findByRole("button", { name: "Open Settings" })).toBeOnTheScreen();
    expect(api.callsTo("PUT", "/v1/me/devices")).toHaveLength(0);
  });

  it("registers this phone for push once allowed", async () => {
    const user = userEvent.setup();
    const { device, api } = await openApp("/account");
    await user.press(await screen.findByRole("button", { name: "Turn on notifications" }));
    await waitFor(() => {
      expect(api.callsTo("PUT", "/v1/me/devices")).toHaveLength(1);
    });
    expect(api.callsTo("PUT", "/v1/me/devices")[0]?.body).toEqual({
      fid: device.fid,
      platform: "android",
    });
    expect(await screen.findByText("Notifications are on for this phone.")).toBeOnTheScreen();
  });
});
