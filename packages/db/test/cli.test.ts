import { afterEach, describe, expect, it } from "vitest";

import { describeUrl, isLocalDatabase, targetUrl } from "../src/cli/shared.js";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe("db CLI helpers", () => {
  it("describes a URL without credentials", () => {
    const described = describeUrl("postgresql://fleettrust:s3cr3t-value@127.0.0.1:5432/fleettrust");
    expect(described).toBe("127.0.0.1:5432/fleettrust");
    expect(described).not.toContain("s3cr3t");
  });

  it("treats only loopback hosts as local (reset safety)", () => {
    expect(isLocalDatabase("postgresql://u:p@127.0.0.1:5432/db")).toBe(true);
    expect(isLocalDatabase("postgresql://u:p@localhost/db")).toBe(true);
    expect(isLocalDatabase("postgresql://u:p@10.20.0.3:5432/db")).toBe(false);
    expect(isLocalDatabase("postgresql://u:p@db.prod.example.com/db")).toBe(false);
  });

  it("selects DATABASE_URL_TEST with --test and explains a missing variable", () => {
    process.env["DATABASE_URL"] = "postgresql://u:p@127.0.0.1/dev";
    process.env["DATABASE_URL_TEST"] = "postgresql://u:p@127.0.0.1/test";
    expect(targetUrl([]).variable).toBe("DATABASE_URL");
    expect(targetUrl(["--test"]).url).toMatch(/\/test$/);

    delete process.env["DATABASE_URL"];
    expect(() => targetUrl([])).toThrow(/pnpm infra:up/);
  });
});
