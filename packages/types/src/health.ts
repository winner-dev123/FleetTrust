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
