import { describe, expect, it } from "@jest/globals";

import { appPath, parseUrl, resolveIncomingUrl, webPathToAppPath } from "./links";

const context = { webUrl: "https://app.fleettrust.example", linkDomain: "fleettrust-prod.web.app" };

describe("deep links", () => {
  it("opens app-scheme links on the matching screen", () => {
    expect(resolveIncomingUrl("fleettrust://requests/abc-123", context)).toBe("/requests/abc-123");
    expect(resolveIncomingUrl("fleettrust://providers/acme-garage", context)).toBe(
      "/providers/acme-garage",
    );
    expect(resolveIncomingUrl("fleettrust://emergency", context)).toBe("/emergency");
    expect(resolveIncomingUrl("fleettrust://requests/new?provider=acme-garage", context)).toBe(
      "/requests/new?provider=acme-garage",
    );
  });

  it("maps web URLs (universal / app links) to the same content in the app", () => {
    expect(resolveIncomingUrl("https://app.fleettrust.example/app/requests/r1", context)).toBe(
      "/requests/r1",
    );
    expect(resolveIncomingUrl("https://app.fleettrust.example/app/messages/c1", context)).toBe(
      "/messages/c1",
    );
    expect(resolveIncomingUrl("https://app.fleettrust.example/app/emergency/i1", context)).toBe(
      "/emergency/i1",
    );
    expect(
      resolveIncomingUrl("https://app.fleettrust.example/providers/acme-garage", context),
    ).toBe("/providers/acme-garage");
    expect(resolveIncomingUrl("https://app.fleettrust.example/articles", context)).toBe(
      "/community",
    );
    expect(
      resolveIncomingUrl(
        "https://app.fleettrust.example/search?q=brakes&category=workshop",
        context,
      ),
    ).toBe("/?q=brakes&category=workshop");
    expect(resolveIncomingUrl("https://app.fleettrust.example/app/appeals", context)).toBe(
      "/account",
    );
  });

  it("sends email sign-in links to the sign-in completion screen", () => {
    const link =
      "https://fleettrust-prod.web.app/__/auth/action?apiKey=k&mode=signIn&oobCode=CODE123&continueUrl=x&lang=en";
    expect(resolveIncomingUrl(link, context)).toBe(`/auth/finish?link=${encodeURIComponent(link)}`);
    const wrapped = `https://app.fleettrust.example/auth/finish?link=${encodeURIComponent(link)}`;
    expect(resolveIncomingUrl(wrapped, context)).toBe(
      `/auth/finish?link=${encodeURIComponent(wrapped)}`,
    );
  });

  it("opens home for unknown screens, foreign hosts and odd input", () => {
    expect(resolveIncomingUrl("https://evil.example/app/requests/r1", context)).toBe("/");
    expect(resolveIncomingUrl("http://app.fleettrust.example/app/requests/r1", context)).toBe("/");
    expect(resolveIncomingUrl("https://app.fleettrust.example/app/billing", context)).toBe("/");
    expect(resolveIncomingUrl("javascript:alert(1)", context)).toBe("/");
    expect(resolveIncomingUrl("fleettrust://admin", context)).toBe("/");
    expect(resolveIncomingUrl("not a url", context)).toBe("/");
    // Look-alike email links from another host are not trusted.
    expect(resolveIncomingUrl("https://evil.example/?mode=signIn&oobCode=X", context)).toBe("/");
  });

  it("rejects IDs that could add segments or queries", () => {
    expect(resolveIncomingUrl("fleettrust://requests/..%2Fadmin", context)).toBe("/");
    expect(webPathToAppPath("/app/requests/a b")).toBeNull();
    expect(appPath("/requests/r1/extra")).toBeNull();
    expect(appPath("/requests/new", { provider: "../x" })).toBe("/requests/new");
    expect(appPath("/", { q: "x".repeat(101) })).toBe("/");
  });

  it("accepts bare paths from the router", () => {
    expect(resolveIncomingUrl("/messages/c1", context)).toBe("/messages/c1");
    expect(resolveIncomingUrl("/nowhere", context)).toBe("/");
  });

  it("parses URLs without the platform URL class", () => {
    expect(parseUrl("https://a.example/x/y?b=2&a=1&a=3&bad=%E0%A4%A")).toEqual({
      scheme: "https",
      host: "a.example",
      path: "/x/y",
      query: { b: "2", a: "1" },
    });
  });
});

describe("the sign-in completion screen", () => {
  const link = "https://fleettrust-prod.web.app/__/auth/action?mode=signIn&oobCode=C1&apiKey=k";

  it("accepts its own path and the app scheme only with a trusted sign-in link", () => {
    const own = `/auth/finish?link=${encodeURIComponent(link)}`;
    expect(resolveIncomingUrl(own, context)).toBe(own);
    expect(
      resolveIncomingUrl(`fleettrust://auth/finish?link=${encodeURIComponent(link)}`, context),
    ).toBe(own);
    const foreign = "https://evil.example/__/auth/action?mode=signIn&oobCode=C1";
    expect(resolveIncomingUrl(`/auth/finish?link=${encodeURIComponent(foreign)}`, context)).toBe(
      "/",
    );
    expect(resolveIncomingUrl("/auth/finish", context)).toBe("/");
  });
});
