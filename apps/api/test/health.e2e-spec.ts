import "reflect-metadata";

import type { Server } from "node:http";

import { healthResponseSchema } from "@fleettrust/types";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { loadApiEnv } from "../src/config/env.js";

describe("GET /health", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const env = loadApiEnv({ NODE_ENV: "test", APP_ENV: "test", APP_VERSION: "test-sha" });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(env)],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns a payload that satisfies the shared contract", async () => {
    const response = await request(app.getHttpServer() as Server)
      .get("/health")
      .expect(200);
    expect(healthResponseSchema.parse(response.body)).toEqual({
      status: "ok",
      service: "fleettrust-api",
      role: "api",
      version: "test-sha",
    });
  });

  it("returns 404 for unknown routes", async () => {
    await request(app.getHttpServer() as Server)
      .get("/does-not-exist")
      .expect(404);
  });
});
