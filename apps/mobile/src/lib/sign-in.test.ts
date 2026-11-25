import { describe, expect, it } from "@jest/globals";

import { FakeDevice } from "../../test/fake-platform";
import {
  finishEmailSignIn,
  PENDING_SIGN_IN_KEY,
  safeReturnPath,
  startEmailSignIn,
} from "./sign-in";

const LINK = "https://fleettrust.web.app/__/auth/action?mode=signIn&oobCode=abc&apiKey=k";
const input = { webUrl: "https://app.example.com", linkDomain: "fleettrust.web.app" };

describe("email-link sign-in", () => {
  it("asks Firebase for a link that opens this app", async () => {
    const device = new FakeDevice();
    await startEmailSignIn(device.platform, {
      ...input,
      email: " Driver@Example.com ",
      returnPath: "/requests/r1",
    });
    expect(device.sentLinks).toEqual([
      {
        email: "driver@example.com",
        settings: {
          url: "https://app.example.com/auth/finish",
          handleCodeInApp: true,
          iOS: { bundleId: "com.fleettrust.app" },
          android: { packageName: "com.fleettrust.app", installApp: true },
          linkDomain: "fleettrust.web.app",
        },
      },
    ]);
  });

  it("finishes on the same phone without asking for the email again, then returns", async () => {
    const device = new FakeDevice();
    device.validLinks.add(LINK);
    await startEmailSignIn(device.platform, {
      ...input,
      email: "driver@example.com",
      returnPath: "/messages/c1",
    });
    expect(await finishEmailSignIn(device.platform, LINK)).toEqual({
      status: "signed-in",
      returnPath: "/messages/c1",
    });
    expect(device.completedLinks).toEqual([{ email: "driver@example.com", url: LINK }]);
    expect(device.store.has(PENDING_SIGN_IN_KEY)).toBe(false);
  });

  it("asks for the email when the link was requested elsewhere or long ago", async () => {
    const device = new FakeDevice();
    device.validLinks.add(LINK);
    expect(await finishEmailSignIn(device.platform, LINK)).toEqual({ status: "need-email" });
    expect(await finishEmailSignIn(device.platform, LINK, "driver@example.com")).toEqual({
      status: "signed-in",
      returnPath: "/",
    });

    const later = new FakeDevice();
    later.validLinks.add(LINK);
    let now = 0;
    await startEmailSignIn(
      later.platform,
      { ...input, email: "a@example.com", returnPath: null },
      () => now,
    );
    now = 25 * 60 * 60 * 1000;
    expect(await finishEmailSignIn(later.platform, LINK, undefined, () => now)).toEqual({
      status: "need-email",
    });
  });

  it("refuses links Firebase doesn't recognise", async () => {
    const device = new FakeDevice();
    expect(
      await finishEmailSignIn(device.platform, "https://evil.example/?mode=signIn&oobCode=x"),
    ).toEqual({
      status: "invalid-link",
    });
    expect(device.completedLinks).toEqual([]);
  });

  it("only returns to screens inside the app", () => {
    expect(safeReturnPath("/requests/r1")).toBe("/requests/r1");
    expect(safeReturnPath("//evil.example")).toBeNull();
    expect(safeReturnPath("https://evil.example")).toBeNull();
    expect(safeReturnPath("/admin")).toBeNull();
  });
});
