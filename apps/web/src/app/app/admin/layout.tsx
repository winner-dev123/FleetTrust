"use client";

import { copy, fill } from "@fleettrust/copy";
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

const t = copy.web.admin.layout;

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
      <PageHeader title={t.notFoundTitle} description={t.notFoundBody} />
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
        <PageHeader title={t.mfaTitle} />
        <Notice tone="caution">
          <p>
            {t.mfaBody} <Link href="/app/admin/security">{t.mfaLink}</Link>.
          </p>
        </Notice>
      </>
    );
  } else if (section && !canOpen(section, me.data.roles)) {
    content = <PageHeader title={t.notFoundTitle} description={t.notFoundBody} />;
  }

  const active = currentHref(
    pathname,
    sections.map((s) => s.href),
  );
  return (
    <AdminContext value={me.data}>
      <div className="stack">
        <nav aria-label={t.nav} className="card" style={{ padding: 8 }}>
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
          {fill(t.signedInAs, {
            email: me.data.email ?? t.staff,
            roles: me.data.roles.map((role) => STAFF_ROLE_LABELS[role]).join(", "),
          })}
        </p>
        {content}
      </div>
    </AdminContext>
  );
}
