"use client";

import { isNotFound } from "@fleettrust/sdk";
import { STAFF_ROLE_LABELS } from "@fleettrust/types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ErrorNotice, Loading, Notice } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { adminSections, canOpen, needsMfa, sectionFor } from "@/lib/admin";
import { AdminContext } from "@/lib/admin-context";
import { currentHref } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

/**
 * Admin console frame (Prompt 26). Shows only the sections the person's staff roles allow;
 * the API enforces the same rules. Until the sign-in used two-step verification, only the
 * setup page opens.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { api, user } = useSession();
  const pathname = usePathname();
  const me = useLoad(() => api.adminMe(), `admin-me-${user?.uid ?? ""}`);

  if (me.status === "loading") return <Loading />;
  if (me.status === "error") {
    return isNotFound(me.error) ? (
      <PageHeader
        title="Page not found"
        description="This page doesn't exist or you don't have access."
      />
    ) : (
      <ErrorNotice error={me.error} onRetry={me.reload} />
    );
  }

  const sections = adminSections(me.data.roles);
  const section = sectionFor(pathname);
  const onSetup = pathname === "/app/admin/security";
  let content: ReactNode = children;
  if (needsMfa(me.data) && !onSetup) {
    content = (
      <>
        <PageHeader title="Two-step sign-in needed" />
        <Notice tone="caution">
          <p>
            Staff tools need two-step sign-in with an authenticator app.{" "}
            <Link href="/app/admin/security">Set it up or sign in with your code</Link>.
          </p>
        </Notice>
      </>
    );
  } else if (section && !canOpen(section, me.data.roles)) {
    content = (
      <PageHeader
        title="Page not found"
        description="This page doesn't exist or you don't have access."
      />
    );
  }

  const active = currentHref(
    pathname,
    sections.map((s) => s.href),
  );
  return (
    <AdminContext value={me.data}>
      <div className="stack">
        <nav aria-label="Admin console" className="card" style={{ padding: 8 }}>
          <ul className="cluster list-plain">
            {sections.map((s) => (
              <li key={s.href} style={{ marginTop: 0 }}>
                <Link href={s.href} aria-current={s.href === active ? "page" : undefined}>
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="small muted" style={{ margin: 0 }}>
          Signed in as {me.data.email ?? "staff"} ·{" "}
          {me.data.roles.map((role) => STAFF_ROLE_LABELS[role]).join(", ")} · Every action here is
          recorded in the audit log.
        </p>
        {content}
      </div>
    </AdminContext>
  );
}
