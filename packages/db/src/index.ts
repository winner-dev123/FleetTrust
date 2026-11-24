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
export {
  type BoundingBox,
  buildSearchQuery,
  DISTANCE_HALF_KM,
  MAX_CORRIDOR_VERTICES,
  type ProviderSearchParams,
  type ProviderSearchRow,
  queryRows,
  RANKING_WEIGHTS,
  refreshProviderSearch,
  type SearchArea,
  type SearchCursor,
  searchProviders,
  searchTerms,
  thinLine,
} from "./search.js";
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
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
