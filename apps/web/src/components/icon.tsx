import type { ReactNode } from "react";

/** Line icons from the FleetTrust Figma Make design (24 px grid, 1.8 px stroke). Decorative. */
export type IconName =
  | "arrow"
  | "car"
  | "check"
  | "chevron"
  | "clock"
  | "fuel"
  | "menu"
  | "pin"
  | "search"
  | "shield"
  | "tools"
  | "tow"
  | "tyre"
  | "user"
  | "wrench";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: (
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),
    car: (
      <>
        <path d="m5 11 1.7-4.2A2 2 0 0 1 8.6 5h6.8a2 2 0 0 1 1.9 1.4L19 11" />
        <path d="M3 14a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v4H3Z" />
        <path d="M5 18v2M19 18v2M7 15h.01M17 15h.01" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m8 10 4 4 4-4" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    fuel: (
      <>
        <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
        <path d="M3 21h14M5 9h10M17 7l2 2v8a2 2 0 0 0 2 2V8l-2-2" />
      </>
    ),
    menu: (
      <>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </>
    ),
    pin: (
      <>
        <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    tools: (
      <>
        <path d="m14.7 6.3 3-3a4.2 4.2 0 0 1-5.4 5.4l-7.6 7.6a2.1 2.1 0 1 0 3 3l7.6-7.6a4.2 4.2 0 0 1 5.4-5.4l-3 3Z" />
      </>
    ),
    tow: (
      <>
        <path d="M4 17h12V8H4Z" />
        <path d="m16 10 4 3v4h-4M7 8V5h5v3" />
        <circle cx="7" cy="19" r="2" />
        <circle cx="17" cy="19" r="2" />
      </>
    ),
    tyre: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v5M12 16v5M3 12h5M16 12h5" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    wrench: (
      <path d="M14.7 6.3a4 4 0 0 0-5-5l2.5 2.5-2.8 2.8-2.5-2.5a4 4 0 0 0 5 5l7 7a2.1 2.1 0 1 1-3 3l-7-7" />
    ),
  };

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}
