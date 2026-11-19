import { spacing, typography } from "@fleettrust/ui";

import { webEnv } from "@/env";

export default function HomePage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: `${spacing.xxl}px ${spacing.lg}px`,
      }}
    >
      <h1 style={{ fontSize: typography.fontSize.xl, margin: 0 }}>FleetTrust</h1>
      <p style={{ color: "var(--color-text-muted)", fontSize: typography.fontSize.lg }}>
        Find vehicle services, request quotes and get help on the road.
      </p>
      <p style={{ color: "var(--color-caution)" }}>
        Pre-release foundation build. No features are available yet.
      </p>
      {webEnv.appEnv !== "production" && (
        <p style={{ color: "var(--color-text-muted)", fontSize: typography.fontSize.sm }}>
          Environment: {webEnv.appEnv}
        </p>
      )}
    </main>
  );
}
