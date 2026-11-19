import { describe, expect, it, vi } from "vitest";

import { assertDockerCompose, composeArgs, DockerUnavailableError } from "../src/docker.ts";

describe("assertDockerCompose", () => {
  it("explains how to fix a missing docker binary", () => {
    const run = vi.fn().mockReturnValue({ status: null, error: new Error("ENOENT") });
    expect(() => {
      assertDockerCompose(run);
    }).toThrow(DockerUnavailableError);
    expect(() => {
      assertDockerCompose(run);
    }).toThrow(/local-infrastructure\.md/);
  });

  it("reports a stopped engine separately from a missing binary", () => {
    const run = vi.fn().mockReturnValue({ status: 1 });
    expect(() => {
      assertDockerCompose(run);
    }).toThrow(/engine running/);
  });

  it("passes when `docker compose version` succeeds", () => {
    const run = vi.fn().mockReturnValue({ status: 0 });
    expect(() => {
      assertDockerCompose(run);
    }).not.toThrow();
    expect(run).toHaveBeenCalledWith("docker", ["compose", "version"], { stdio: "ignore" });
  });
});

describe("composeArgs", () => {
  it("always passes the local env file and compose file", () => {
    const args = composeArgs(["up"]);
    expect(args.slice(0, 2)).toEqual(["compose", "--env-file"]);
    expect(args[2]).toMatch(/infra[\\/]local[\\/]\.env$/);
    expect(args[4]).toMatch(/infra[\\/]local[\\/]compose\.yaml$/);
    expect(args.at(-1)).toBe("up");
    expect(args).not.toContain("--profile");
  });

  it("enables the email profile on request", () => {
    expect(composeArgs(["up"], { withEmail: true })).toEqual(
      expect.arrayContaining(["--profile", "email"]),
    );
  });
});
