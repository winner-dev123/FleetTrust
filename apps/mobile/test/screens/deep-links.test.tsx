import { describe, expect, it } from "@jest/globals";
import { userEvent } from "@testing-library/react-native";
import { act, screen } from "expo-router/testing-library";

import { openApp } from "../app";
import { FakeDevice } from "../fake-platform";
import { IDS } from "../fixtures";

describe("deep links open the right screen", () => {
  it("opens a provider profile signed out", async () => {
    const { result } = await openApp("/providers/acme-garage", { signedIn: false });
    expect(await screen.findByRole("header", { name: "Acme Garage" })).toBeOnTheScreen();
    expect(result.getPathname()).toBe("/providers/acme-garage");
    expect(
      screen.getByText("Sign in to see phone numbers and street addresses."),
    ).toBeOnTheScreen();
  });

  it("asks a signed-out person to sign in, and remembers where they were going", async () => {
    const user = userEvent.setup();
    const { result } = await openApp(`/requests/${IDS.request}`, { signedIn: false });
    expect(await screen.findByText("Sign in to see this request")).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Sign in" }));
    expect(result.getPathname()).toBe("/sign-in");
    expect(result.getSearchParams()).toEqual({ returnTo: `/requests/${IDS.request}` });
  });

  it("opens a request with its quotes when signed in", async () => {
    await openApp(`/requests/${IDS.request}`);
    expect(await screen.findByText("ZAR 950.00 per job (indicative)")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Accept this quote" })).toBeOnTheScreen();
  });

  it("starts on the screen of the notification that launched the app", async () => {
    const device = new FakeDevice();
    device.initialNotification = {
      title: "New quote",
      body: null,
      data: { requestId: IDS.request },
    };
    const { result } = await openApp("/", { device });
    expect(await screen.findByText("ZAR 950.00 per job (indicative)")).toBeOnTheScreen();
    expect(result.getPathname()).toBe(`/requests/${IDS.request}`);
  });

  it("opens the conversation when a message notification is tapped in the background", async () => {
    const { device, result } = await openApp("/");
    await act(async () => {
      device.tapNotification({
        title: "New message",
        body: null,
        data: { conversationId: IDS.conversation },
      });
      await Promise.resolve();
    });
    expect(await screen.findByText("Hello, how can we help?")).toBeOnTheScreen();
    expect(result.getPathname()).toBe(`/messages/${IDS.conversation}`);
  });

  it("shows a banner for notifications that arrive while the app is open", async () => {
    const user = userEvent.setup();
    const { device, result } = await openApp("/");
    await act(async () => {
      device.deliverForeground({
        title: "New quote",
        body: "Acme Garage sent a quote",
        data: { requestId: IDS.request },
      });
      await Promise.resolve();
    });
    expect(await screen.findByText("Acme Garage sent a quote")).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Open" }));
    expect(result.getPathname()).toBe(`/requests/${IDS.request}`);
    expect(screen.queryByText("Acme Garage sent a quote")).not.toBeOnTheScreen();
  });

  it("finishes an email sign-in link and returns to the screen that asked for it", async () => {
    // Tests run with the local web origin (http://localhost:3000) as the trusted link host.
    const link = "http://localhost:3000/__/auth/action?mode=signIn&oobCode=abc&apiKey=k";
    const device = new FakeDevice();
    device.validLinks.add(link);
    device.store.set(
      "ft:signin:pending",
      JSON.stringify({
        email: "driver@example.com",
        returnPath: "/messages/" + IDS.conversation,
        at: Date.now(),
      }),
    );
    const { result } = await openApp(`/auth/finish?link=${encodeURIComponent(link)}`, {
      device,
      signedIn: false,
    });
    expect(await screen.findByText("Hello, how can we help?")).toBeOnTheScreen();
    expect(result.getPathname()).toBe(`/messages/${IDS.conversation}`);
    expect(device.completedLinks).toEqual([{ email: "driver@example.com", url: link }]);
  });

  it("ignores sign-in links from hosts it doesn't trust", async () => {
    const link = "https://evil.example/__/auth/action?mode=signIn&oobCode=abc";
    const device = new FakeDevice();
    device.validLinks.add(link);
    const { result } = await openApp(`/auth/finish?link=${encodeURIComponent(link)}`, {
      device,
      signedIn: false,
    });
    expect(await screen.findByRole("header", { name: "Find help nearby" })).toBeOnTheScreen();
    expect(result.getPathname()).toBe("/");
    expect(device.completedLinks).toEqual([]);
  });
});
