import { copy } from "@fleettrust/copy";
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
  { href: "/emergency", label: copy.web.nav.emergencyHelp, emergency: true },
  { href: "/search", label: copy.web.nav.findServices },
  { href: "/articles", label: copy.web.nav.knowledgeHub },
  { href: "/jobs", label: copy.web.nav.jobs },
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
      title: copy.web.nav.you,
      items: [
        { href: "/app/emergency", label: copy.web.nav.emergency, emergency: true },
        { href: "/app", label: copy.web.nav.dashboard },
        { href: "/app/requests", label: copy.web.nav.requests },
        { href: "/app/vehicles", label: copy.web.nav.vehicles },
        { href: "/app/messages", label: copy.web.nav.messages },
        { href: "/app/notifications", label: copy.web.nav.notifications },
        { href: "/app/community", label: copy.web.nav.community },
        { href: "/app/account", label: copy.web.nav.account },
      ],
    },
  ];

  for (const membership of organizations) {
    const org = membership.organization;
    const base = `/app/o/${org.id}`;
    const items: NavItem[] = [];
    if (org.kind === "provider") {
      items.push({ href: base, label: copy.web.nav.profileSetup });
      if (can(membership, "profile.manage")) {
        items.push({ href: `${base}/profile`, label: copy.web.nav.businessProfile });
      }
      if (can(membership, "hours.manage")) {
        items.push({ href: `${base}/branches`, label: copy.web.nav.branches });
      }
      if (can(membership, "catalog.manage")) {
        items.push({ href: `${base}/services`, label: copy.web.nav.services });
      }
      if (can(membership, "requests.respond")) {
        items.push({ href: `${base}/inquiries`, label: copy.web.nav.inquiries });
      }
    } else {
      items.push({ href: base, label: copy.web.nav.fleetDashboard });
      if (can(membership, "vehicles.manage")) {
        items.push({ href: `${base}/vehicles`, label: copy.web.nav.fleetVehicles });
      }
      items.push({ href: `${base}/incidents`, label: copy.web.nav.incidents });
      if (can(membership, "jobs.manage"))
        items.push({ href: `${base}/jobs`, label: copy.web.nav.fleetJobs });
    }
    if (can(membership, "members.read")) {
      items.push({ href: `${base}/members`, label: copy.web.nav.members });
    }
    items.push({ href: `${base}/usage`, label: copy.web.nav.planUsage });
    sections.push({ title: org.name, items });
  }

  if (options.isStaff) {
    sections.push({
      title: copy.web.nav.staff,
      items: [{ href: "/app/admin", label: copy.web.nav.adminConsole }],
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
