import { describe, expect, it } from "vitest";

import {
  containsRange,
  intersectRanges,
  localWindows,
  mergeRanges,
  slotStarts,
  subtractRanges,
} from "./schedule.js";

const H = 3_600_000;
const at = (iso: string) => Date.parse(iso);

describe("range maths", () => {
  it("merges, intersects and subtracts half-open ranges", () => {
    expect(
      mergeRanges([
        { start: 0, end: 2 },
        { start: 2, end: 3 },
        { start: 5, end: 6 },
      ]),
    ).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 6 },
    ]);
    expect(intersectRanges([{ start: 0, end: 10 }], [{ start: 5, end: 15 }])).toEqual([
      { start: 5, end: 10 },
    ]);
    expect(subtractRanges([{ start: 0, end: 10 }], [{ start: 3, end: 4 }])).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 10 },
    ]);
    expect(containsRange([{ start: 0, end: 10 }], { start: 9, end: 10 })).toBe(true);
    expect(containsRange([{ start: 0, end: 10 }], { start: 9, end: 11 })).toBe(false);
  });
});

describe("localWindows", () => {
  const nineToFive = () => [{ start: 9 * 60, end: 17 * 60 }];

  it("places local hours at the right UTC instants, per timezone", () => {
    const jhb = localWindows("2027-03-15", "Africa/Johannesburg", nineToFive);
    expect(jhb).toContainEqual({
      start: at("2027-03-15T07:00:00Z"),
      end: at("2027-03-15T15:00:00Z"),
    });
    const ny = localWindows("2027-03-15", "America/New_York", nineToFive);
    expect(ny).toContainEqual({
      start: at("2027-03-15T13:00:00Z"),
      end: at("2027-03-15T21:00:00Z"),
    });
  });

  it("a day containing a spring-forward change is an hour shorter", () => {
    const allDay = () => [{ start: 0, end: 1440 }];
    const day = localWindows("2027-03-14", "America/New_York", (d) =>
      d === "2027-03-14" ? allDay() : [],
    );
    expect(day).toHaveLength(1);
    expect((day[0]?.end ?? 0) - (day[0]?.start ?? 0)).toBe(23 * H);
  });

  it("overnight hours from the previous day spill past midnight", () => {
    const windows = localWindows("2027-03-16", "UTC", (d) =>
      d === "2027-03-15" ? [{ start: 22 * 60, end: 30 * 60 }] : [],
    );
    expect(windows).toEqual([
      { start: at("2027-03-15T22:00:00Z"), end: at("2027-03-16T06:00:00Z") },
    ]);
  });
});

describe("slotStarts", () => {
  it("skips local times that don't exist", () => {
    const starts = slotStarts("2027-03-14", "America/New_York", 30).map((s) => s.minute);
    expect(starts).toContain(90); // 01:30
    expect(starts).not.toContain(120); // 02:00 doesn't exist
    expect(starts).not.toContain(150); // 02:30 doesn't exist
    expect(starts).toContain(180); // 03:00
    expect(slotStarts("2027-03-15", "America/New_York", 30)).toHaveLength(48);
  });
});
