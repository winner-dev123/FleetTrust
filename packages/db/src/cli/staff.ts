import { and, eq } from "drizzle-orm";

import { createDatabase } from "../database.js";
import { recordAuditEvent } from "../events.js";
import { PLATFORM_ROLES, type PlatformRole, platformStaff } from "../schema/plans.js";
import { users } from "../schema/users.js";
import { describeUrl, runCli, targetUrl } from "./shared.js";

const USAGE = `Usage:
  pnpm db:staff list
  pnpm db:staff grant <email> <role>
  pnpm db:staff revoke <email> <role>
Roles: ${PLATFORM_ROLES.join(", ")}
The user must have signed in at least once (their account is created on first sign-in).`;

/**
 * Grants FleetTrust staff roles (billing operator) from the command line. There is
 * deliberately no API for this until the admin console adds MFA-protected management
 * (Prompt 26). Every change is written to the audit log as a system action.
 */
await runCli(async () => {
  const args = process.argv.slice(2).filter((arg) => arg !== "--test");
  const [command, email, role] = args;
  const { url, variable } = targetUrl(process.argv.slice(2));
  const handle = createDatabase({ url, maxConnections: 1, applicationName: "fleettrust-staff" });
  try {
    if (command === "list") {
      const rows = await handle.db
        .select({ email: users.email, role: platformStaff.role, since: platformStaff.createdAt })
        .from(platformStaff)
        .innerJoin(users, eq(users.id, platformStaff.userId));
      console.warn(`Staff on ${describeUrl(url)} (${variable}):`);
      for (const row of rows) {
        console.warn(
          `  ${row.email ?? "(no email)"}  ${row.role}  since ${row.since.toISOString()}`,
        );
      }
      return;
    }
    if ((command !== "grant" && command !== "revoke") || !email || !role) throw new Error(USAGE);
    if (!(PLATFORM_ROLES as readonly string[]).includes(role)) throw new Error(USAGE);
    const [user] = await handle.db
      .select()
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .limit(1);
    if (!user) throw new Error(`No account for ${email}. ${USAGE.split("\n").at(-1) ?? ""}`);

    await handle.db.transaction(async (tx) => {
      if (command === "grant") {
        await tx
          .insert(platformStaff)
          .values({ userId: user.id, role: role as PlatformRole })
          .onConflictDoNothing();
      } else {
        await tx
          .delete(platformStaff)
          .where(
            and(eq(platformStaff.userId, user.id), eq(platformStaff.role, role as PlatformRole)),
          );
      }
      await recordAuditEvent(tx, {
        actorType: "system",
        action: command === "grant" ? "staff.role_granted" : "staff.role_revoked",
        targetType: "user",
        targetId: user.id,
        metadata: { role, via: "cli" },
      });
    });
    console.warn(
      `${command === "grant" ? "Granted" : "Revoked"} ${role} for ${email} on ${describeUrl(url)}.`,
    );
  } finally {
    await handle.close();
  }
});
