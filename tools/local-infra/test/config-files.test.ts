import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { repoRoot } from "../src/paths.ts";

/**
 * Static checks on the local infrastructure definitions. They run without Docker, so
 * the "no public default credentials" and "localhost only" rules are enforced in CI.
 */

interface ComposeService {
  image?: string;
  profiles?: string[];
  ports?: string[];
  environment?: Record<string, string>;
  healthcheck?: { test?: unknown };
  volumes?: string[];
}

const compose = parse(readFileSync(path.join(repoRoot, "infra/local/compose.yaml"), "utf8")) as {
  services: Record<string, ComposeService>;
  volumes: Record<string, unknown>;
};
const services = Object.entries(compose.services);

const CREDENTIAL_KEY = /(PASSWORD|USER|AUTH|SECRET|TOKEN)/;
const REQUIRED_VAR = /^\$\{[A-Z0-9_]+:\?[^}]+\}$/;

describe("infra/local/compose.yaml", () => {
  it("defines the services Prompt 03 requires", () => {
    expect(Object.keys(compose.services).sort()).toEqual(["mailpit", "postgres", "redis"]);
    expect(compose.services["mailpit"]?.profiles).toEqual(["email"]);
  });

  it.each(services)("%s pins its image by version and digest", (_name, service) => {
    expect(service.image).toMatch(/^[\w./-]+:[\w.-]+@sha256:[a-f0-9]{64}$/);
    expect(service.image).not.toMatch(/:latest@/);
  });

  it.each(services)("%s has a health check", (_name, service) => {
    expect(service.healthcheck?.test).toBeDefined();
  });

  it.each(services)("%s publishes ports on 127.0.0.1 only", (_name, service) => {
    expect(service.ports?.length).toBeGreaterThan(0);
    for (const port of service.ports ?? []) expect(port).toMatch(/^127\.0\.0\.1:/);
  });

  it.each(services)(
    "%s takes every credential from the env file, with no default",
    (_name, service) => {
      for (const [key, value] of Object.entries(service.environment ?? {})) {
        if (
          !CREDENTIAL_KEY.test(key) ||
          key === "MP_SMTP_AUTH_ACCEPT_ANY" ||
          key === "MP_SMTP_AUTH_ALLOW_INSECURE"
        ) {
          continue;
        }
        const parts = key === "MP_UI_AUTH" ? value.split(/(?<=\}):(?=\$\{)/) : [value];
        for (const part of parts)
          expect(part, `${key} must use \${VAR:?message}`).toMatch(REQUIRED_VAR);
      }
    },
  );

  it("persists Postgres and Redis data in named volumes", () => {
    expect(Object.keys(compose.volumes).sort()).toEqual(["pgdata", "redisdata"]);
    expect(compose.services["postgres"]?.volumes).toContain("pgdata:/var/lib/postgresql/data");
    expect(compose.services["redis"]?.volumes).toContain("redisdata:/data");
  });

  it("requires a Redis password", () => {
    const service = compose.services["redis"] as ComposeService & { command?: string[] };
    expect(service.command?.join(" ")).toContain("--requirepass");
  });
});

describe("infra/local/postgres/20-fleettrust.sh", () => {
  const script = readFileSync(path.join(repoRoot, "infra/local/postgres/20-fleettrust.sh"), "utf8");

  it("uses LF line endings (CRLF breaks the shell inside the container)", () => {
    expect(script).not.toContain("\r");
  });

  it("enables PostGIS in both the dev and test databases and stops on errors", () => {
    expect(script.match(/CREATE EXTENSION IF NOT EXISTS postgis;/g)).toHaveLength(2);
    expect(script).toContain("set -eu");
    expect(script).toContain("ON_ERROR_STOP=1");
  });
});

describe("Firebase emulator configuration", () => {
  const firebase = JSON.parse(readFileSync(path.join(repoRoot, "firebase.json"), "utf8")) as {
    storage: { rules: string };
    emulators: Record<string, { host?: string; port?: number } | boolean>;
  };
  const firebaserc = JSON.parse(readFileSync(path.join(repoRoot, ".firebaserc"), "utf8")) as {
    projects: { default: string };
  };

  it("uses a demo- project ID so emulators can never reach real Firebase resources", () => {
    expect(firebaserc.projects.default).toMatch(/^demo-/);
  });

  it("binds every emulator to 127.0.0.1", () => {
    for (const [name, config] of Object.entries(firebase.emulators)) {
      if (typeof config === "boolean") continue;
      expect(config.host, name).toBe("127.0.0.1");
    }
  });

  it("denies all direct client access to Storage (ADR-0006)", () => {
    const rules = readFileSync(path.join(repoRoot, firebase.storage.rules), "utf8");
    const allows = rules.match(/allow [^;]+;/g) ?? [];
    expect(allows).toEqual(["allow read, write: if false;"]);
  });
});
