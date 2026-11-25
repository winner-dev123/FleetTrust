import { type INestApplication, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { ModulesContainer } from "@nestjs/core";

import { IS_PUBLIC } from "../../src/modules/identity/decorators.js";

export interface RouteInfo {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  params: string[];
  isPublic: boolean;
  controller: string;
}

const METHODS: Partial<Record<RequestMethod, RouteInfo["method"]>> = {
  [RequestMethod.GET]: "GET",
  [RequestMethod.POST]: "POST",
  [RequestMethod.PUT]: "PUT",
  [RequestMethod.PATCH]: "PATCH",
  [RequestMethod.DELETE]: "DELETE",
};

/** Every HTTP route the running app exposes, read from Nest's controller metadata. */
export function listRoutes(app: INestApplication): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const metatype = wrapper.metatype as (new (...args: never[]) => object) | null;
      if (!metatype) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? "");
      const classPublic = Reflect.getMetadata(IS_PUBLIC, metatype) === true;
      const proto = metatype.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (typeof handler !== "function" || name === "constructor") continue;
        const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (sub === undefined || verb === undefined) continue;
        const method = METHODS[verb];
        if (!method) continue;
        for (const piece of Array.isArray(sub) ? sub : [sub]) {
          const path = `/${[base, piece].filter((p) => p && p !== "/").join("/")}`.replace(
            /\/+/g,
            "/",
          );
          routes.push({
            method,
            path,
            params: [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1] ?? ""),
            isPublic: classPublic || Reflect.getMetadata(IS_PUBLIC, handler) === true,
            controller: metatype.name,
          });
        }
      }
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
