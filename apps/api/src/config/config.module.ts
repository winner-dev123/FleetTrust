import { type DynamicModule, Module } from "@nestjs/common";

import type { ApiEnv } from "./env.js";

/** Injection token for the validated, immutable API environment. */
export const API_ENV = Symbol("API_ENV");

@Module({})
export class ApiConfigModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: ApiConfigModule,
      global: true,
      providers: [{ provide: API_ENV, useValue: Object.freeze({ ...env }) }],
      exports: [API_ENV],
    };
  }
}
