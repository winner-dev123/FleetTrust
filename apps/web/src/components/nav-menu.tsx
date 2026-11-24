"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";

import { currentHref, type NavItem } from "@/lib/nav";

/**
 * A navigation list that collapses behind a "Menu" button on small screens (a disclosure:
 * aria-expanded + aria-controls). On wide screens CSS shows the list and hides the button.
 */
export function NavMenu({
  label,
  items,
  sections,
}: {
  label: string;
  items?: readonly NavItem[];
  sections?: readonly { title: string; items: readonly NavItem[] }[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const groups = sections ?? [{ title: "", items: items ?? [] }];
  const current = currentHref(
    pathname,
    groups.flatMap((group) => group.items.map((item) => item.href)),
  );

  const link = (item: NavItem) => (
    <Link
      href={item.href}
      className={item.emergency ? "nav__link nav__link--danger" : "nav__link"}
      aria-current={item.href === current ? "page" : undefined}
      onClick={() => {
        setOpen(false);
      }}
    >
      {item.label}
    </Link>
  );

  return (
    <nav aria-label={label}>
      <button
        type="button"
        className="btn btn--ghost nav__toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {open ? "Close menu" : "Menu"}
      </button>
      <ul className="nav__list" id={listId} data-open={open}>
        {sections
          ? sections.map((group, index) => (
              <li key={`${String(index)}-${group.title}`}>
                <p className="app-nav__section">{group.title}</p>
                <ul className="list-plain">
                  {group.items.map((item) => (
                    <li key={item.href} style={{ marginTop: 0 }}>
                      {link(item)}
                    </li>
                  ))}
                </ul>
              </li>
            ))
          : (items ?? []).map((item) => <li key={item.href}>{link(item)}</li>)}
      </ul>
    </nav>
  );
}
