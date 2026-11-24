import { describe, expect, it } from "vitest";

import { scheduleStatus } from "./maintenance.js";

const base = {
  intervalKm: null,
  intervalDays: null,
  lastDoneKm: null,
  lastDoneOn: null,
  remindBeforeKm: 1_000,
  remindBeforeDays: 14,
};

describe("scheduleStatus", () => {
  it("uses whichever of distance and time is closer", () => {
    const both = {
      ...base,
      intervalKm: 10_000,
      lastDoneKm: 50_000,
      intervalDays: 365,
      lastDoneOn: "2026-01-01",
    };
    expect(scheduleStatus(both, 55_000, "2026-06-01")).toEqual({
      status: "ok",
      nextDueKm: 60_000,
      nextDueOn: "2027-01-01",
    });
    expect(scheduleStatus(both, 59_500, "2026-06-01").status).toBe("due_soon");
    expect(scheduleStatus(both, 55_000, "2026-12-20").status).toBe("due_soon");
    expect(scheduleStatus(both, 55_000, "2027-01-02").status).toBe("overdue");
    expect(scheduleStatus(both, 60_000, "2026-06-01").status).toBe("overdue");
  });

  it("is unknown without a baseline or a reading", () => {
    expect(scheduleStatus({ ...base, intervalKm: 10_000 }, 50_000, "2026-06-01").status).toBe(
      "unknown",
    );
    expect(
      scheduleStatus({ ...base, intervalKm: 10_000, lastDoneKm: 0 }, null, "2026-06-01").status,
    ).toBe("unknown");
  });
});
