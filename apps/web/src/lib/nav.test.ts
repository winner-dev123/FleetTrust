import type { MyOrganization, Permission } from "@fleettrust/types";
import { describe, expect, it } from "vitest";

import { appNavigation, currentHref, PUBLIC_NAV } from "./nav";

function membership(kind: "provider" | "fleet", permissions: Permission[]): MyOrganization {
  return {
    organization: {
      id: "0190a000-0000-7000-8000-000000000001",
      kind,
      name: kind === "provider" ? "Acme Garage" : "Road Fleet",
      status: "active",
      timeZone: "Africa/Johannesburg",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    membershipId: "0190a000-0000-7000-8000-000000000009",
    role: "staff",
    branchId: null,
    permissions,
  };
}

const hrefs = (sections: ReturnType<typeof appNavigation>) =>
  sections.flatMap((section) => section.items.map((item) => item.href));

describe("appNavigation", () => {
  it("lists emergency first, for everyone", () => {
    const [you] = appNavigation([], { isStaff: false });
    expect(you?.items[0]).toMatchObject({ href: "/app/emergency", emergency: true });
    expect(PUBLIC_NAV[0]).toMatchObject({ href: "/emergency", emergency: true });
  });

  it("shows only what the membership's permissions allow", () => {
    const org = membership("provider", ["org.read", "requests.respond"]);
    const links = hrefs(appNavigation([org], { isStaff: false }));
    const base = `/app/o/${org.organization.id}`;
    expect(links).toContain(`${base}/inquiries`);
    expect(links).not.toContain(`${base}/services`);
    expect(links).not.toContain(`${base}/profile`);
    expect(links).not.toContain(`${base}/members`);
  });

  it("gives fleets fleet pages and providers provider pages", () => {
    const fleet = membership("fleet", ["vehicles.manage", "jobs.manage", "members.read"]);
    const links = hrefs(appNavigation([fleet], { isStaff: false }));
    const base = `/app/o/${fleet.organization.id}`;
    expect(links).toEqual(
      expect.arrayContaining([`${base}/vehicles`, `${base}/jobs`, `${base}/incidents`]),
    );
    expect(links).not.toContain(`${base}/inquiries`);
  });

  it("shows the staff area to staff only", () => {
    expect(hrefs(appNavigation([], { isStaff: false }))).not.toContain("/app/admin");
    expect(hrefs(appNavigation([], { isStaff: true }))).toContain("/app/admin");
  });
});

describe("currentHref", () => {
  it("marks the most specific match", () => {
    const list = ["/app", "/app/requests", "/app/requests/new"];
    expect(currentHref("/app/requests/123", list)).toBe("/app/requests");
    expect(currentHref("/app/requests/new", list)).toBe("/app/requests/new");
    expect(currentHref("/app", list)).toBe("/app");
    expect(currentHref("/apparel", list)).toBeNull();
  });
});
