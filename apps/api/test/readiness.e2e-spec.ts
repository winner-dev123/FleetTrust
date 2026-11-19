import "reflect-metadata";

import type { Server } from "node:http";

import { createTestDatabase, type TestDatabase } from "@fleettrust/db/testing";
import { readinessResponseSchema } from "@fleettrust/types";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { loadApiEnv } from "../src/config/env.js";
import { DATABASE, type DatabaseProvider } from "../src/database/database.module.js";

const env = loadApiEnv({ NODE_ENV: "test", APP_ENV: "test", APP_VERSION: "test-sha" });

async function appWith(database: DatabaseProvider): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(env)] })
    .overrideProvider(DATABASE)
    .useValue(database)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useLogger(false);
  await app.init();
  return app;
}

describe("GET /health/ready", () => {
  let pglite: TestDatabase;
  let app: INestApplication | undefined;

  beforeAll(async () => {
    pglite = await createTestDatabase();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("is ready when the database answers (PGlite + PostGIS, migrated)", async () => {
    app = await appWith({
      db: pglite.db,
      ping: async () => {
        await pglite.client.query("SELECT 1");
      },
      close: () => Promise.resolve(),
    });
    const response = await request(app.getHttpServer() as Server)
      .get("/health/ready")
      .expect(200);
    expect(readinessResponseSchema.parse(response.body)).toEqual({
      status: "ready",
      checks: { database: "ok" },
    });
  });

  it("returns 503 without leaking error details when the database is down", async () => {
    app = await appWith({
      db: pglite.db,
      ping: () => Promise.reject(new Error("connect ECONNREFUSED 10.1.2.3:5432 password=hunter2")),
      close: () => Promise.resolve(),
    });
    const response = await request(app.getHttpServer() as Server)
      .get("/health/ready")
      .expect(503);
    expect(readinessResponseSchema.parse(response.body)).toEqual({
      status: "not_ready",
      checks: { database: "unavailable" },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/10\.1\.2\.3|hunter2|ECONNREFUSED/);
  });

  it("returns 503 within the timeout when the database hangs", async () => {
    app = await appWith({
      db: pglite.db,
      ping: () => new Promise(() => undefined),
      close: () => Promise.resolve(),
    });
    const started = Date.now();
    await request(app.getHttpServer() as Server)
      .get("/health/ready")
      .expect(503);
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it("reports not_configured when DATABASE_URL is absent (local without Docker)", async () => {
    app = await appWith(null);
    const response = await request(app.getHttpServer() as Server)
      .get("/health/ready")
      .expect(503);
    expect(response.body).toEqual({ status: "not_ready", checks: { database: "not_configured" } });
  });

  it("liveness stays 200 even when the database is down", async () => {
    app = await appWith({
      db: pglite.db,
      ping: () => Promise.reject(new Error("down")),
      close: () => Promise.resolve(),
    });
    await request(app.getHttpServer() as Server)
      .get("/health")
      .expect(200);
  });
});
