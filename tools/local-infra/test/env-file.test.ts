import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deriveConnectionStrings, ensureLocalEnvFile, parseEnvFile } from "../src/env-file.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ft-env-"));
  file = path.join(dir, ".env");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const read = () => parseEnvFile(readFileSync(file, "utf8"));

describe("ensureLocalEnvFile", () => {
  it("creates the file with random, distinct, non-trivial secrets", () => {
    const result = ensureLocalEnvFile(file);
    const env = read();

    expect(result.created).toBe(true);
    const secrets = ["POSTGRES_PASSWORD", "REDIS_PASSWORD", "MAILPIT_UI_PASSWORD"].map(
      (key) => env.get(key) ?? "",
    );
    for (const secret of secrets) expect(secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(new Set(secrets).size).toBe(3);
  });

  it("generates different secrets for different developers", () => {
    ensureLocalEnvFile(file);
    const first = read().get("POSTGRES_PASSWORD");
    rmSync(file);
    ensureLocalEnvFile(file);
    expect(read().get("POSTGRES_PASSWORD")).not.toBe(first);
  });

  it("never overwrites existing values on re-run", () => {
    ensureLocalEnvFile(file);
    const before = read();
    const result = ensureLocalEnvFile(file);

    expect(result).toEqual({ created: false, added: [] });
    expect(read()).toEqual(before);
  });

  it("regenerates only settings that were removed, and keeps custom ones", () => {
    ensureLocalEnvFile(file);
    const before = read();
    const text = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("REDIS_PASSWORD="))
      .join("\n");
    writeFileSync(file, `${text}\nMY_CUSTOM=1\n`);

    const result = ensureLocalEnvFile(file);
    const after = read();

    expect(result.added).toEqual(["REDIS_PASSWORD"]);
    expect(after.get("POSTGRES_PASSWORD")).toBe(before.get("POSTGRES_PASSWORD"));
    expect(after.get("REDIS_PASSWORD")).not.toBe(before.get("REDIS_PASSWORD"));
    expect(after.get("REDIS_URL")).toContain(after.get("REDIS_PASSWORD"));
    expect(after.get("MY_CUSTOM")).toBe("1");
  });

  it("recomputes derived connection strings when a base setting changes", () => {
    ensureLocalEnvFile(file);
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace("POSTGRES_PORT=5432", "POSTGRES_PORT=55432"),
    );
    ensureLocalEnvFile(file);
    expect(read().get("DATABASE_URL")).toMatch(/@127\.0\.0\.1:55432\/fleettrust$/);
  });

  it("never prints secret values in its result", () => {
    const result = ensureLocalEnvFile(file);
    const env = read();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(env.get("POSTGRES_PASSWORD"));
    expect(serialized).not.toContain(env.get("REDIS_PASSWORD"));
  });
});

describe("deriveConnectionStrings", () => {
  it("percent-encodes credentials that contain URL-special characters", () => {
    const derived = deriveConnectionStrings(
      new Map([
        ["POSTGRES_USER", "dev"],
        ["POSTGRES_PASSWORD", "p@ss/word:1"],
        ["POSTGRES_PORT", "5432"],
        ["POSTGRES_DB", "fleettrust"],
        ["POSTGRES_TEST_DB", "fleettrust_test"],
        ["REDIS_PASSWORD", "r#1"],
        ["REDIS_PORT", "6379"],
        ["MAILPIT_SMTP_PORT", "1025"],
      ]),
    );
    expect(derived.get("DATABASE_URL")).toBe(
      "postgresql://dev:p%40ss%2Fword%3A1@127.0.0.1:5432/fleettrust",
    );
    expect(derived.get("REDIS_URL")).toBe("redis://:r%231@127.0.0.1:6379/0");
    expect(() => new URL(derived.get("DATABASE_URL_TEST") ?? "")).not.toThrow();
  });
});

describe("parseEnvFile", () => {
  it("handles comments, blank lines, quotes and '=' inside values", () => {
    const env = parseEnvFile('# comment\n\nA=1\nB="two words"\nC=x=y\n  D = spaced \n');
    expect([...env]).toEqual([
      ["A", "1"],
      ["B", "two words"],
      ["C", "x=y"],
      ["D", "spaced"],
    ]);
  });
});
