import { describe, expect, it } from "@jest/globals";
import { userEvent } from "@testing-library/react-native";
import { act, screen, waitFor } from "expo-router/testing-library";

import { openApp } from "../app";
import { FakeApi } from "../fake-api";
import { FakeDevice } from "../fake-platform";
import { IDS } from "../fixtures";

/** Degraded-network behaviour: drafts, the message outbox, and what never waits offline. */
describe("offline drafts", () => {
  it("keeps an unfinished request on the phone and restores it next time", async () => {
    const user = userEvent.setup();
    const device = new FakeDevice();
    const first = await openApp("/requests/new", { device });
    await user.type(
      await screen.findByLabelText("What's the problem?"),
      "Engine light on, loses power uphill",
    );
    await waitFor(() => {
      expect([...device.store.keys()]).toContain("ft:draft:user-1:request:new");
    });
    await first.result.unmount();

    await openApp("/requests/new", { device });
    expect(await screen.findByText("Draft restored")).toBeOnTheScreen();
    expect(screen.getByLabelText("What's the problem?")).toHaveDisplayValue(
      "Engine light on, loses power uphill",
    );
  });

  it("won't send a request offline, and keeps it as a draft", async () => {
    const user = userEvent.setup();
    const { api } = await openApp("/requests/new", { online: false });
    await user.type(await screen.findByLabelText("What's the problem?"), "Flat tyre, no spare");
    expect(
      screen.getByText("Your request is saved on this phone. Send it when you have signal."),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Send request" })).toBeDisabled();
    expect(api.callsTo("POST", "/v1/me/service-requests")).toHaveLength(0);
  });

  it("reuses the same request ID when a send fails part-way, so it's created once", async () => {
    const user = userEvent.setup();
    const device = new FakeDevice();
    device.locationPermission = "granted";
    const api = new FakeApi();
    await openApp("/requests/new", { device, api });
    await user.type(
      await screen.findByLabelText("What's the problem?"),
      "Brakes grinding at low speed",
    );
    await user.press(screen.getByRole("button", { name: "Use my location" }));
    await screen.findByText("Where is the vehicle?: Your current location");

    api.offline = true;
    await user.press(screen.getByRole("button", { name: "Send request" }));
    expect(
      await screen.findByText(/Your request is saved on this phone; send it again/),
    ).toBeOnTheScreen();
    api.offline = false;
    await user.press(screen.getByRole("button", { name: "Send request" }));
    await screen.findByText("ZAR 950.00 per job (indicative)");

    const sends = api.callsTo("POST", "/v1/me/service-requests");
    expect(sends).toHaveLength(2);
    const [a, b] = sends.map((call) => (call.body as { clientRequestId: string }).clientRequestId);
    expect(a).toBe(b);
    // Sent: the draft is gone.
    expect(device.store.has("ft:draft:user-1:request:new")).toBe(false);
  });

  it("erases drafts and queued messages from the phone at sign-out", async () => {
    const user = userEvent.setup();
    const device = new FakeDevice();
    device.store.set(
      "ft:draft:user-1:message:c1",
      JSON.stringify({ savedAt: new Date().toISOString(), value: "hi" }),
    );
    device.store.set("ft:outbox:user-1", "[]");
    await openApp("/account", { device });
    await user.press(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => {
      expect(device.user).toBeNull();
    });
    expect([...device.store.keys()].filter((key) => key.includes("user-1"))).toEqual([]);
  });
});

describe("messages while offline", () => {
  it("waits on the phone and sends once when the connection returns", async () => {
    const user = userEvent.setup();
    const { device, api } = await openApp(`/messages/${IDS.conversation}`, { online: true });
    expect(await screen.findByText("Hello, how can we help?")).toBeOnTheScreen();
    await act(async () => {
      device.setOnline(false);
      await Promise.resolve();
    });
    await user.type(screen.getByLabelText("Message"), "Running 10 minutes late");
    await user.press(screen.getByRole("button", { name: "Send when online" }));
    expect(await screen.findByText("Waiting to send (offline)")).toBeOnTheScreen();
    expect(api.callsTo("POST", `/v1/conversations/${IDS.conversation}/messages`)).toHaveLength(0);

    await act(async () => {
      device.setOnline(true);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(api.callsTo("POST", `/v1/conversations/${IDS.conversation}/messages`)).toHaveLength(1);
    });
    expect(api.messages.map((m) => m.body)).toEqual([
      "Hello, how can we help?",
      "Running 10 minutes late",
    ]);
  });
});

describe("emergency never waits for a connection", () => {
  it("shows official guidance even when FleetTrust can't be reached", async () => {
    const api = new FakeApi();
    api.offline = true;
    await openApp("/emergency", { api });
    expect(await screen.findByText("If anyone is in danger")).toBeOnTheScreen();
    expect(await screen.findByText(/Alerts need a connection/)).toBeOnTheScreen();
  });

  it("disables alerts offline and says to call the emergency number instead of queueing", async () => {
    const { device } = await openApp("/emergency");
    expect(await screen.findByRole("button", { name: "Send alert" })).toBeEnabled();
    await act(async () => {
      device.setOnline(false);
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Send alert" })).toBeDisabled();
    expect(
      screen.getByText(/can't be sent right now. If anyone is in danger, call your local/),
    ).toBeOnTheScreen();
  });

  it("asks once to confirm, and a retry after a dropped connection can't send a second alert", async () => {
    const user = userEvent.setup();
    const { api, result } = await openApp("/emergency");
    await user.press(
      await screen.findByRole("checkbox", { name: "Share my location with this alert" }),
    );
    await user.press(screen.getByRole("button", { name: "Send alert" }));
    expect(await screen.findByText("Send this alert now?")).toBeOnTheScreen();
    expect(api.callsTo("POST", "/v1/emergency/incidents")).toHaveLength(0);

    api.offline = true;
    await user.press(screen.getByRole("button", { name: "Yes, send alert" }));
    expect(await screen.findByText(/The alert was not sent/)).toBeOnTheScreen();
    api.offline = false;
    await user.press(screen.getByRole("button", { name: "Yes, send alert" }));
    await waitFor(() => {
      expect(result.getPathname()).toBe(`/emergency/${IDS.incident}`);
    });
    const ids = api
      .callsTo("POST", "/v1/emergency/incidents")
      .map((call) => (call.body as { clientIncidentId: string }).clientIncidentId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("works signed out: guidance and a way to sign in, no alert form", async () => {
    await openApp("/emergency", { signedIn: false });
    expect(await screen.findByText("If anyone is in danger")).toBeOnTheScreen();
    expect(screen.getByText("Sign in to send alerts")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Send alert" })).not.toBeOnTheScreen();
  });
});
