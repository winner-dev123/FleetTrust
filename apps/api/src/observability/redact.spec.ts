import { describe, expect, it } from "vitest";

import { redactString } from "./redact.js";

describe("redactString", () => {
  it.each([
    [
      "postgresql://fleettrust:s3cr3t-pw@10.0.0.5:5432/db",
      "s3cr3t-pw",
      "postgresql://fleettrust:[REDACTED]@10.0.0.5:5432/db",
    ],
    ["redis://:r3dis-pw@127.0.0.1:6379/0", "r3dis-pw", "redis://:[REDACTED]@127.0.0.1:6379/0"],
    [
      "Authorization: Bearer abc.DEF-123_xyz",
      "abc.DEF-123_xyz",
      "Authorization: Bearer [REDACTED]",
    ],
    [
      "token eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl here",
      "eyJhbGciOiJSUzI1NiJ9",
      "token [REDACTED] here",
    ],
    [
      "GET /callback?code=1&token=tok_live_999&x=1",
      "tok_live_999",
      "GET /callback?code=1&token=[REDACTED]&x=1",
    ],
    ['{"password":"hunter2"}', "hunter2", '{"password":"[REDACTED]"}'],
    ["api_key=AIzaSyFAKEKEY123", "AIzaSyFAKEKEY123", "api_key=[REDACTED]"],
  ])("scrubs %s", (input, secret, expected) => {
    const output = redactString(input);
    expect(output).not.toContain(secret);
    expect(output).toBe(expected);
  });

  it("leaves ordinary text alone", () => {
    const text = "GET /health/ready 503 in 2.004s; user tokenized the input; passwordless sign-in";
    expect(redactString(text)).toBe(text);
  });
});
