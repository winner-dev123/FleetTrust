import type { MyOrganization, Permission } from "@fleettrust/types";

export interface NavItem {
  href: string;
  label: string;
  /** Emergency entry: styled with the danger colour and always listed first. */
  emergency?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

const can = (org: MyOrganization, permission: Permission) => org.permissions.includes(permission);

/** Public site navigation. */
export const PUBLIC_NAV: readonly NavItem[] = [
  { href: "/emergency", label: "Emergency help", emergency: true },
  { href: "/search", label: "Find services" },
  { href: "/articles", label: "Knowledge hub" },
  { href: "/jobs", label: "Jobs" },
];

/**
 * Signed-in navigation. Items follow the person's memberships and permissions, so nobody is
 * shown a page that would only answer 403/404. The API still checks every request.
 */
export function appNavigation(
  organizations: readonly MyOrganization[],
  options: { isStaff: boolean },
): NavSection[] {
  const sections: NavSection[] = [
    {
      title: "You",
      items: [
        { href: "/app/emergency", label: "Emergency", emergency: true },
        { href: "/app", label: "Dashboard" },
        { href: "/app/requests", label: "Service requests" },
        { href: "/app/vehicles", label: "My vehicles" },
        { href: "/app/messages", label: "Messages" },
        { href: "/app/notifications", label: "Notifications" },
        { href: "/app/community", label: "Community" },
        { href: "/app/account", label: "Account and usage" },
      ],
    },
  ];

  for (const membership of organizations) {
    const org = membership.organization;
    const base = `/app/o/${org.id}`;
    const items: NavItem[] = [];
    if (org.kind === "provider") {
      items.push({ href: base, label: "Profile setup" });
      if (can(membership, "profile.manage")) {
        items.push({ href: `${base}/profile`, label: "Business profile" });
      }
      if (can(membership, "hours.manage")) {
        items.push({ href: `${base}/branches`, label: "Branches and hours" });
      }
      if (can(membership, "catalog.manage")) {
        items.push({ href: `${base}/services`, label: "Services and prices" });
      }
      if (can(membership, "requests.respond")) {
        items.push({ href: `${base}/inquiries`, label: "Inquiries" });
      }
    } else {
      items.push({ href: base, label: "Fleet dashboard" });
      if (can(membership, "vehicles.manage")) {
        items.push({ href: `${base}/vehicles`, label: "Vehicles" });
      }
      items.push({ href: `${base}/incidents`, label: "Incidents" });
      if (can(membership, "jobs.manage")) items.push({ href: `${base}/jobs`, label: "Jobs" });
    }
    if (can(membership, "members.read")) {
      items.push({ href: `${base}/members`, label: "Members" });
    }
    items.push({ href: `${base}/usage`, label: "Plan usage" });
    sections.push({ title: org.name, items });
  }

  if (options.isStaff) {
    sections.push({
      title: "FleetTrust staff",
      items: [{ href: "/app/admin", label: "Trust and safety" }],
    });
  }
  return sections;
}

/** The nav item to mark as the current page: the longest href that prefixes the path. */
export function currentHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const matches = pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
