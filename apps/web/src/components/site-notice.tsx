"use client";

import { useEffect, useState } from "react";

import { apiClient } from "@/lib/firebase";

/**
 * The admin "site notice" (feature setting `site.notice`), loaded in the browser after the
 * page is shown, so a slow or unavailable API never delays a page (the emergency page too).
 */
export function SiteNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    apiClient()
      .publicConfig()
      .then(
        (config) => {
          if (active) setNotice(config.siteNotice);
        },
        () => undefined,
      );
    return () => {
      active = false;
    };
  }, []);
  if (!notice) return null;
  return (
    <div className="site-notice" role="status">
      <div className="container">
        <p className="small" style={{ margin: 0 }}>
          {notice}
        </p>
      </div>
    </div>
  );
}
