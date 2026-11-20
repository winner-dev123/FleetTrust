export {
  createDatabase,
  type Database,
  type DatabaseHandle,
  type DatabaseOptions,
  type Executor,
  migrationsFolder,
  runMigrations,
  type Schema,
  type Transaction,
} from "./database.js";
export {
  type AuditEventInput,
  enqueueOutboxEvent,
  type OutboxEventInput,
  recordAuditEvent,
} from "./events.js";
export * from "./schema/index.js";
export {
  consumeDailyQuota,
  type ConsumeDailyQuotaInput,
  type ConsumeResult,
  dailyUsage,
  isValidTimeZone,
  localDate,
  type QuotaSubject,
} from "./quotas.js";
export { runSeed, type SeedReport, type SeedStep, seedSteps } from "./seed/index.js";
export { PLAN_CATALOG, type PlanDefinition } from "./seed/plans.data.js";
export { distanceMeters, geographyOf, withinBoundingBox, withinMeters } from "./spatial.js";
export {
  assertSameTenant,
  type TenantContext,
  tenantContext,
  tenantFilter,
  type TenantId,
  TenantMismatchError,
} from "./tenancy.js";

/** Query operators re-exported so consumers share this package's drizzle-orm instance (one set of types). */
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
