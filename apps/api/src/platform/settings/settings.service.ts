import {
  asc,
  type Database,
  eq,
  type Executor,
  featureSettings,
  recordAuditEvent,
  serviceCategorySettings,
  users,
} from "@fleettrust/db";
import {
  defaultServiceCategory,
  FEATURE_SETTING_KEYS,
  FEATURE_SETTINGS,
  type FeatureSettingDto,
  type FeatureSettingKey,
  type FeatureSettingValue,
  PROVIDER_CATEGORIES,
  type ProviderCategory,
  type ServiceCategoryDto,
  type UpdateServiceCategory,
} from "@fleettrust/types";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";

/** Values are stored wrapped, so JSON null (e.g. "no notice") isn't an SQL NULL. */
const unwrap = (stored: unknown): unknown =>
  typeof stored === "object" && stored !== null && "value" in stored ? stored.value : undefined;

const isKey = (key: string): key is FeatureSettingKey =>
  (FEATURE_SETTING_KEYS as string[]).includes(key);

/**
 * Admin feature settings and service-category settings (Prompt 26, ADR-0033). Values live in
 * the database; a missing row means the default from @fleettrust/types. Reads are a single
 * primary-key lookup, so services read them when they need them (no cache to go stale).
 */
@Injectable()
export class SettingsService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseProvider) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  async get<K extends FeatureSettingKey>(
    key: K,
    executor: Executor = this.db,
  ): Promise<FeatureSettingValue<K>> {
    const definition = FEATURE_SETTINGS[key];
    const [row] = await executor
      .select({ value: featureSettings.value })
      .from(featureSettings)
      .where(eq(featureSettings.key, key))
      .limit(1);
    if (!row) return definition.defaultValue as FeatureSettingValue<K>;
    // A stored value that no longer fits the schema (after a code change) falls back safely.
    const parsed = definition.schema.safeParse(unwrap(row.value));
    return (parsed.success ? parsed.data : definition.defaultValue) as FeatureSettingValue<K>;
  }

  async list(): Promise<FeatureSettingDto[]> {
    const rows = await this.db
      .select({
        key: featureSettings.key,
        value: featureSettings.value,
        updatedAt: featureSettings.updatedAt,
        email: users.email,
      })
      .from(featureSettings)
      .leftJoin(users, eq(users.id, featureSettings.updatedBy));
    return FEATURE_SETTING_KEYS.map((key) => {
      const definition = FEATURE_SETTINGS[key];
      const row = rows.find((r) => r.key === key);
      const parsed = row ? definition.schema.safeParse(unwrap(row.value)) : null;
      return {
        key,
        label: definition.label,
        description: definition.description,
        value: parsed?.success ? parsed.data : definition.defaultValue,
        defaultValue: definition.defaultValue,
        public: definition.public,
        updatedAt: row?.updatedAt.toISOString() ?? null,
        updatedBy: row?.email ?? null,
      };
    });
  }

  /** Validates against the setting's schema and records who changed what (audited). */
  async set(
    actorId: string,
    key: string,
    value: unknown,
    requestId?: string,
  ): Promise<FeatureSettingDto> {
    if (!isKey(key)) {
      throw new NotFoundException({
        statusCode: 404,
        error: "not_found",
        reason: "unknown_setting",
      });
    }
    const parsed = FEATURE_SETTINGS[key].schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: "validation_failed",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    await this.db.transaction(async (tx) => {
      const before = await this.get(key, tx);
      await tx
        .insert(featureSettings)
        .values({ key, value: { value: parsed.data }, updatedBy: actorId, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: featureSettings.key,
          set: { value: { value: parsed.data }, updatedBy: actorId, updatedAt: new Date() },
        });
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId,
        action: "feature.setting_changed",
        targetType: "feature_setting",
        targetId: key,
        requestId,
        metadata: { before, after: parsed.data },
      });
    });
    const updated = (await this.list()).find((setting) => setting.key === key);
    if (!updated) throw new Error("setting vanished");
    return updated;
  }

  // -------------------------------------------------------------------------------------------
  // Service taxonomy
  // -------------------------------------------------------------------------------------------

  async categories(): Promise<ServiceCategoryDto[]> {
    const rows = await this.db
      .select()
      .from(serviceCategorySettings)
      .orderBy(asc(serviceCategorySettings.category));
    return PROVIDER_CATEGORIES.map((category) => {
      const base = defaultServiceCategory(category);
      const row = rows.find((r) => r.category === category);
      return row
        ? {
            ...base,
            description: row.description,
            sortOrder: row.sortOrder,
            acceptingNewOfferings: row.acceptingNewOfferings,
            updatedAt: row.updatedAt.toISOString(),
          }
        : base;
    }).sort((a, b) => a.sortOrder - b.sortOrder || a.category.localeCompare(b.category));
  }

  async acceptsNewOfferings(category: string, executor: Executor = this.db): Promise<boolean> {
    const [row] = await executor
      .select({ accepting: serviceCategorySettings.acceptingNewOfferings })
      .from(serviceCategorySettings)
      .where(eq(serviceCategorySettings.category, category))
      .limit(1);
    return row?.accepting ?? true;
  }

  async updateCategory(
    actorId: string,
    category: ProviderCategory,
    change: UpdateServiceCategory,
    requestId?: string,
  ): Promise<ServiceCategoryDto> {
    await this.db.transaction(async (tx) => {
      const current = (await this.categoriesWith(tx)).find((c) => c.category === category);
      if (!current) throw new NotFoundException({ statusCode: 404, error: "not_found" });
      const next = {
        description: change.description === undefined ? current.description : change.description,
        sortOrder: change.sortOrder ?? current.sortOrder,
        acceptingNewOfferings: change.acceptingNewOfferings ?? current.acceptingNewOfferings,
      };
      await tx
        .insert(serviceCategorySettings)
        .values({ category, ...next, updatedBy: actorId, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: serviceCategorySettings.category,
          set: { ...next, updatedBy: actorId, updatedAt: new Date() },
        });
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId,
        action: "taxonomy.category_updated",
        targetType: "service_category",
        targetId: category,
        requestId,
        metadata: { change },
      });
    });
    const updated = (await this.categories()).find((c) => c.category === category);
    if (!updated) throw new Error("category vanished");
    return updated;
  }

  private async categoriesWith(executor: Executor): Promise<ServiceCategoryDto[]> {
    const rows = await executor.select().from(serviceCategorySettings);
    return PROVIDER_CATEGORIES.map((category) => {
      const row = rows.find((r) => r.category === category);
      const base = defaultServiceCategory(category);
      return row
        ? {
            ...base,
            description: row.description,
            sortOrder: row.sortOrder,
            acceptingNewOfferings: row.acceptingNewOfferings,
            updatedAt: row.updatedAt.toISOString(),
          }
        : base;
    });
  }
}
