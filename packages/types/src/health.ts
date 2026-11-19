import { z } from "zod";

/** Runtime role of an API container (docs/adr/0002). */
export const appRoleSchema = z.enum(["api", "worker"]);
export type AppRole = z.infer<typeof appRoleSchema>;

/** Response of `GET /health` (liveness). Contains no sensitive data. */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("fleettrust-api"),
  role: appRoleSchema,
  version: z.string().min(1),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Per-dependency readiness. Values are coarse on purpose: no hostnames, versions or error text. */
export const dependencyStatusSchema = z.enum(["ok", "unavailable", "not_configured"]);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

/** Response of `GET /health/ready` (HTTP 200 when ready, 503 otherwise). */
export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  checks: z.object({
    database: dependencyStatusSchema,
  }),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
