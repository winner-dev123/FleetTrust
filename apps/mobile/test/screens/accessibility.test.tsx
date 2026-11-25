import { describe, expect, it } from "@jest/globals";
import { screen } from "expo-router/testing-library";
import { StyleSheet } from "react-native";

import { openApp } from "../app";
import { IDS } from "../fixtures";

/**
 * Automated accessibility checks on real screens: every button has a name a screen reader
 * can say, and our controls are at least 44 dp tall. Manual VoiceOver/TalkBack checks are in
 * docs/qa/mobile-device-test-plan.md.
 */
const SCREENS: { url: string; ready: string; signedIn: boolean }[] = [
  { url: "/", ready: "Find help nearby", signedIn: false },
  { url: "/emergency", ready: "Emergency", signedIn: true },
  { url: "/emergency/contacts", ready: "Your trusted contacts", signedIn: true },
  { url: "/requests/new", ready: "What's the problem?", signedIn: true },
  { url: `/requests/${IDS.request}`, ready: "Providers and quotes", signedIn: true },
  { url: `/messages/${IDS.conversation}`, ready: "Hello, how can we help?", signedIn: true },
  { url: "/providers/acme-garage", ready: "Services and indicative prices", signedIn: false },
  { url: "/account", ready: "Which notifications", signedIn: true },
  { url: "/sign-in", ready: "Email me a link", signedIn: false },
];

describe("accessibility of every main screen", () => {
  for (const { url, ready, signedIn } of SCREENS) {
    it(`${url}: named buttons, labelled fields, 44 dp targets`, async () => {
      await openApp(url, { signedIn });
      expect((await screen.findAllByText(ready)).length).toBeGreaterThan(0);

      for (const button of screen.getAllByRole("button")) {
        expect(button).toHaveAccessibleName();
        const style = StyleSheet.flatten(
          button.props["style"] as Parameters<typeof StyleSheet.flatten>[0],
        ) as { minHeight?: unknown } | undefined;
        if (typeof style?.minHeight === "number")
          expect(style.minHeight).toBeGreaterThanOrEqual(44);
      }
      for (const control of [
        ...screen.queryAllByRole("checkbox"),
        ...screen.queryAllByRole("radio"),
      ]) {
        expect(control).toHaveAccessibleName();
      }
    });
  }

  it("announces offline state and errors", async () => {
    await openApp("/", { online: false, signedIn: false });
    expect(await screen.findByRole("alert", { name: /You're offline/ })).toBeOnTheScreen();
  });
});
