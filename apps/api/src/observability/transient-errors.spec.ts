import { describe, expect, it } from "vitest";

import { isTransientDatabaseError } from "./transient-errors.js";

const withCode = (code: string) => Object.assign(new Error("db error"), { code });

describe("transient database errors", () => {
  it("recognises pool exhaustion and load or concurrency SQLSTATEs, also when wrapped", () => {
    expect(isTransientDatabaseError(new Error("timeout exceeded when trying to connect"))).toBe(
      true,
    );
    expect(isTransientDatabaseError(withCode("40001"))).toBe(true);
    expect(isTransientDatabaseError(withCode("53300"))).toBe(true);
    const wrapped = new Error("Failed query: insert into ...", { cause: withCode("40P01") });
    expect(isTransientDatabaseError(wrapped)).toBe(true);
  });

  it("leaves real failures alone", () => {
    expect(isTransientDatabaseError(withCode("23505"))).toBe(false); // unique violation
    expect(isTransientDatabaseError(new Error("boom"))).toBe(false);
    expect(isTransientDatabaseError("timeout exceeded when trying to connect")).toBe(false);
    expect(isTransientDatabaseError(null)).toBe(false);
  });
});
