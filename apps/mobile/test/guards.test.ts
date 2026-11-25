import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "@jest/globals";
import { FORBIDDEN_EMERGENCY_WORDING } from "@fleettrust/types";
import type { ExpoConfig } from "expo/config";

import appConfig, { APP_LINK_PATHS } from "../app.config";
import { webPathToAppPath } from "../src/lib/links";

const root = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = [...sourceFiles(join(root, "app")), ...sourceFiles(join(root, "src"))].map(
  (path) => ({
    path: relative(root, path).replaceAll("\\", "/"),
    text: readFileSync(path, "utf8"),
  }),
);

describe("product copy guards (same rules as the web)", () => {
  it("scans the app", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("emergency screens never imply that help is certain (SRS J3, ADR-0010)", () => {
    const emergency = files.filter((file) => file.path.includes("emergency"));
    expect(emergency.length).toBeGreaterThanOrEqual(3);
    for (const file of emergency) expect(FORBIDDEN_EMERGENCY_WORDING.test(file.text)).toBe(false);
  });

  it("no screen offers checkout, card payment or verified payments (ADR-0008)", () => {
    const forbidden =
      /\b(?:checkout|add to cart|pay now|buy now|card number|payment (?:verified|confirmed|successful)|escrow)\b/i;
    for (const file of files)
      expect({ path: file.path, hit: forbidden.test(file.text) }).toEqual({
        path: file.path,
        hit: false,
      });
  });

  it("no screen shows star ratings or review scores (ADR-0011)", () => {
    const forbidden = /★|☆|\b(?:star rating|rate this provider|leave a review|average rating)\b/i;
    for (const file of files)
      expect({ path: file.path, hit: forbidden.test(file.text) }).toEqual({
        path: file.path,
        hit: false,
      });
  });

  it("screens never import native modules directly (they go through src/platform)", () => {
    const native =
      /from "(?:@react-native-firebase\/|expo-location|@react-native-async-storage|@react-native-community\/netinfo|react-native-permissions)/;
    for (const file of files.filter((f) => !f.path.startsWith("src/platform/"))) {
      expect({ path: file.path, hit: native.test(file.text) }).toEqual({
        path: file.path,
        hit: false,
      });
    }
  });
});

describe("app config", () => {
  const build = (env: Record<string, string | undefined>): ExpoConfig => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      return appConfig({
        config: {},
        projectRoot: root,
        staticConfigPath: null,
        packageJsonPath: null,
      });
    } finally {
      process.env = saved;
    }
  };

  it("never asks for background location, on either platform", () => {
    const config = build({});
    expect(config.android?.blockedPermissions).toContain(
      "android.permission.ACCESS_BACKGROUND_LOCATION",
    );
    expect(config.android?.permissions).not.toContain(
      "android.permission.ACCESS_BACKGROUND_LOCATION",
    );
    const location = config.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-location",
    );
    expect(location).toEqual([
      "expo-location",
      expect.objectContaining({
        locationAlwaysPermission: false,
        locationAlwaysAndWhenInUsePermission: false,
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
      }),
    ]);
    expect(config.ios?.infoPlist?.["UIBackgroundModes"]).toEqual(["remote-notification"]);
  });

  it("adds universal / app links only for configured https hosts", () => {
    expect(build({}).android?.intentFilters).toEqual([]);
    expect(build({ EXPO_PUBLIC_WEB_URL: "http://localhost:3000" }).ios?.associatedDomains).toEqual(
      [],
    );
    const config = build({
      EXPO_PUBLIC_WEB_URL: "https://app.fleettrust.example",
      EXPO_PUBLIC_LINK_DOMAIN: "fleettrust.web.app",
    });
    expect(config.ios?.associatedDomains).toEqual([
      "applinks:app.fleettrust.example",
      "applinks:fleettrust.web.app",
    ]);
    const [filter] = config.android?.intentFilters ?? [];
    expect(filter?.autoVerify).toBe(true);
    expect(filter?.data).toContainEqual({
      scheme: "https",
      host: "app.fleettrust.example",
      pathPrefix: "/app",
    });
  });

  it("only claims web paths the app can show", () => {
    for (const prefix of APP_LINK_PATHS) {
      if (prefix === "/auth/finish") continue;
      const path = webPathToAppPath(prefix) ?? webPathToAppPath(`${prefix}/example`);
      expect({ prefix, path }).not.toEqual({ prefix, path: null });
    }
  });
});
