// @vitest-environment jsdom
import type { EntitlementsResponse } from "@fleettrust/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { Checkbox, SelectField, TextArea, TextField } from "./field";
import { Badge, EmptyState, ErrorNotice, Loading, Notice } from "./feedback";
import { Card, PageHeader, UsageMeter } from "./layout";
import { NavMenu } from "./nav-menu";
import { ProviderMap } from "./provider-map";
import { UsagePanel } from "./usage-panel";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/requests/42" }));

class ResizeObserverStub {
  observe() {
    return undefined;
  }
  disconnect() {
    return undefined;
  }
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
// jsdom has no canvas; axe only uses it to spot icon fonts.
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

afterEach(() => {
  cleanup();
});

/** WCAG 2.x A and AA rules (axe-core). Colour contrast is covered by the token tests. */
async function expectAccessible(ui: ReactElement) {
  const { container } = render(<main>{ui}</main>);
  const result = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false } },
  });
  expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

describe("form fields", () => {
  it("tie label, hint and error to the control", async () => {
    render(<TextField label="Email address" hint="We never share it" error="Enter an email" />);
    const input = screen.getByLabelText(/Email address/);
    expect(input).toHaveProperty("ariaInvalid", "true");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    const text = describedBy
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent)
      .join(" | ");
    expect(text).toBe("We never share it | Enter an email");
    cleanup();
    await expectAccessible(
      <form>
        <TextField label="Name" required />
        <TextArea label="Details" hint="Optional details" />
        <SelectField label="Type" options={[{ value: "a", label: "A" }]} required />
        <Checkbox label="Open now" hint="Only providers open right now" />
      </form>,
    );
  });

  it("marks optional fields in words, not only by an asterisk", () => {
    render(<TextField label="Make" />);
    expect(screen.getByText("(optional)")).toBeTruthy();
  });
});

describe("buttons and feedback", () => {
  it("busy buttons are disabled and announced", () => {
    render(<Button busy>Sending…</Button>);
    const button = screen.getByRole("button", { name: "Sending…" });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("errors interrupt, confirmations are polite", () => {
    render(
      <>
        <Notice tone="danger" live="assertive">
          Failed
        </Notice>
        <Notice tone="success" live="polite">
          Saved
        </Notice>
      </>,
    );
    expect(screen.getByRole("alert").textContent).toBe("Failed");
    expect(screen.getByRole("status").textContent).toBe("Saved");
  });

  it("are accessible together", async () => {
    await expectAccessible(
      <>
        <PageHeader title="Requests" description="Your requests" actions={<Button>New</Button>} />
        <Card title="Card">
          <Badge tone="verified">Business registration: verified</Badge>
          <Badge tone="caution">Business location: not verified</Badge>
        </Card>
        <EmptyState title="Nothing here" />
        <Loading />
        <ErrorNotice error={new Error("boom")} onRetry={() => undefined} />
        <UsageMeter label="Service requests per day" used={3} limit={5} />
      </>,
    );
  });
});

describe("navigation", () => {
  const items = [
    { href: "/app/emergency", label: "Emergency", emergency: true },
    { href: "/app", label: "Dashboard" },
    { href: "/app/requests", label: "Service requests" },
  ];

  it("is a disclosure that marks the current page", async () => {
    render(<NavMenu label="Your areas" items={items} />);
    const toggle = screen.getByRole("button", { name: "Menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls") ?? "")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Service requests" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBeNull();
    cleanup();
    await expectAccessible(<NavMenu label="Areas" sections={[{ title: "You", items }]} />);
  });
});

describe("usage dashboard", () => {
  const usage: EntitlementsResponse = {
    subject: { type: "user", id: "0190a000-0000-7000-8000-000000000001" },
    plan: {
      code: "personal-plus",
      name: "Personal Plus",
      version: 1,
      source: "assignment",
      activatedAt: "2026-11-01T10:00:00.000Z",
      endsAt: null,
    },
    timeZone: "Africa/Johannesburg",
    period: "2026-11-24",
    entitlements: [
      {
        key: "service_requests.daily",
        kind: "daily",
        limit: 10,
        used: 4,
        source: "plan",
        graceUntil: null,
        overLimit: false,
      },
      {
        key: "articles.daily",
        kind: "daily",
        limit: null,
        used: 2,
        source: "override",
        graceUntil: null,
        overLimit: false,
      },
    ],
  };

  it("shows usage as text and as a meter, and never says the plan was paid", async () => {
    render(<UsagePanel usage={usage} />);
    expect(screen.getByText("4 of 10 used")).toBeTruthy();
    expect(screen.getByText("2 used (no limit)")).toBeTruthy();
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-label")).toBe("Service requests per day: 4 of 10 used");
    const text = document.body.textContent;
    expect(text).toMatch(/Activated by FleetTrust staff/);
    expect(text).toMatch(/emergency alerts are never limited/);
    expect(text).not.toMatch(/\bpaid\b|payment (verified|confirmed)/i);
    cleanup();
    await expectAccessible(<UsagePanel usage={usage} />);
  });
});

describe("map", () => {
  it("repeats the list: numbered, labelled pin buttons", async () => {
    const onSelect = vi.fn();
    render(
      <ProviderMap
        center={{ lat: -33.92, lng: 18.42 }}
        config={null}
        selectedId="b"
        onSelect={onSelect}
        pins={[
          {
            id: "a",
            number: 1,
            label: "Acme Garage, 1.2 km",
            location: { lat: -33.92, lng: 18.42 },
          },
          { id: "b", number: 2, label: "Tow Co, 3.4 km", location: { lat: -33.93, lng: 18.43 } },
        ]}
      />,
    );
    const pin = screen.getByRole("button", { name: "1. Acme Garage, 1.2 km" });
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    expect(
      screen.getByRole("button", { name: "2. Tow Co, 3.4 km" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(pin);
    expect(onSelect).toHaveBeenCalledWith("a");
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "North" })).toBeTruthy();
    cleanup();
    await expectAccessible(
      <ProviderMap
        center={{ lat: -33.92, lng: 18.42 }}
        config={null}
        selectedId={null}
        onSelect={onSelect}
        pins={[{ id: "a", number: 1, label: "Acme", location: { lat: -33.92, lng: 18.42 } }]}
      />,
    );
  });
});
