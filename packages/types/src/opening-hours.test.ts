import { describe, expect, it } from "vitest";

import {
  branchHoursRequestSchema,
  hoursExceptionRequestSchema,
  localClock,
  localDateSchema,
  openingStatus,
  type WeeklyHours,
} from "./opening-hours.js";

const everyDay = (opens: string, closes: string): WeeklyHours =>
  Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ opens, closes }]]),
  );

const status = (
  weekly: WeeklyHours | null,
  at: string,
  timeZone = "UTC",
  exceptions: Parameters<typeof openingStatus>[0]["exceptions"] = [],
) => openingStatus({ weekly, exceptions, timeZone }, new Date(at));

describe("openingStatus: timezones", () => {
  it("uses local wall-clock time across the spring DST change (Europe/London)", () => {
    const weekly = everyDay("08:00", "17:00");
    // Saturday 28 March 2026: GMT (UTC+0). 07:30Z is 07:30 local: closed.
    expect(status(weekly, "2026-03-28T07:30:00Z", "Europe/London")).toMatchObject({
      isOpen: false,
      localTime: "2026-03-28T07:30",
      opensAt: "2026-03-28T08:00",
    });
    // Sunday 29 March 2026: BST (UTC+1). The same 07:30Z is 08:30 local: open.
    expect(status(weekly, "2026-03-29T07:30:00Z", "Europe/London")).toMatchObject({
      isOpen: true,
      localTime: "2026-03-29T08:30",
      closesAt: "2026-03-29T17:00",
    });
  });

  it("follows the autumn DST change", () => {
    const weekly = everyDay("08:00", "17:00");
    // Saturday 24 October 2026, BST: 16:30Z is 17:30 local, closed.
    expect(status(weekly, "2026-10-24T16:30:00Z", "Europe/London").isOpen).toBe(false);
    // Sunday 25 October 2026, GMT: 16:30Z is 16:30 local, open.
    expect(status(weekly, "2026-10-25T16:30:00Z", "Europe/London").isOpen).toBe(true);
  });

  it("uses the local calendar date when it differs from UTC (Pacific/Auckland)", () => {
    const weekly = everyDay("00:00", "24:00");
    // 24 Dec 12:00Z is 25 Dec 01:00 in Auckland (NZDT, UTC+13).
    const at = "2026-12-24T12:00:00Z";
    expect(localClock(new Date(at), "Pacific/Auckland")).toEqual({
      date: "2026-12-25",
      minute: 60,
    });
    const christmas = [{ date: "2026-12-25", closed: true, label: "Christmas Day", intervals: [] }];
    expect(status(weekly, at, "Pacific/Auckland", christmas)).toMatchObject({
      isOpen: false,
      exception: "Christmas Day",
      opensAt: "2026-12-26T00:00",
    });
    // In UTC it's still the 24th, so the same exception doesn't apply there.
    expect(status(weekly, at, "UTC", christmas)).toMatchObject({ isOpen: true, exception: null });
  });

  it("works for zones with half-hour offsets (Asia/Kolkata)", () => {
    // 03:00Z = 08:30 IST.
    const result = status(everyDay("08:30", "17:30"), "2026-11-20T03:00:00Z", "Asia/Kolkata");
    expect(result).toMatchObject({ isOpen: true, localTime: "2026-11-20T08:30" });
  });
});

describe("openingStatus: intervals", () => {
  it("counts an overnight interval after midnight", () => {
    // Friday 20 Nov 2026, 22:00–06:00; it's Saturday 02:00.
    const weekly: WeeklyHours = { fri: [{ opens: "22:00", closes: "06:00" }] };
    expect(status(weekly, "2026-11-21T02:00:00Z")).toMatchObject({
      isOpen: true,
      closesAt: "2026-11-21T06:00",
    });
    expect(status(weekly, "2026-11-21T06:00:00Z").isOpen).toBe(false);
  });

  it("merges contiguous intervals across midnight into one closing time", () => {
    const weekly: WeeklyHours = {
      fri: [{ opens: "18:00", closes: "24:00" }],
      sat: [{ opens: "00:00", closes: "02:00" }],
    };
    expect(status(weekly, "2026-11-20T23:00:00Z").closesAt).toBe("2026-11-21T02:00");
  });

  it("reports no closing time when open around the clock", () => {
    expect(status(everyDay("00:00", "24:00"), "2026-11-20T12:00:00Z")).toMatchObject({
      isOpen: true,
      closesAt: null,
    });
  });

  it("handles split days (lunch break) and the next opening", () => {
    const weekly: WeeklyHours = {
      fri: [
        { opens: "08:00", closes: "12:00" },
        { opens: "13:00", closes: "17:00" },
      ],
    };
    expect(status(weekly, "2026-11-20T12:30:00Z")).toMatchObject({
      isOpen: false,
      opensAt: "2026-11-20T13:00",
    });
    // After Friday closes the next opening is the following Friday.
    expect(status(weekly, "2026-11-20T18:00:00Z").opensAt).toBe("2026-11-27T08:00");
  });

  it("says hours are unknown (not closed) when none were provided", () => {
    expect(status(null, "2026-11-20T12:00:00Z")).toMatchObject({ known: false, isOpen: false });
  });
});

describe("openingStatus: holiday exceptions", () => {
  const weekly: WeeklyHours = {
    fri: [{ opens: "22:00", closes: "06:00" }],
    sat: [{ opens: "08:00", closes: "17:00" }],
    mon: [{ opens: "08:00", closes: "17:00" }],
  };

  it("a closed day replaces that day's hours, but the previous night's shift still ends normally", () => {
    const closed = [{ date: "2026-11-21", closed: true, label: "Public holiday", intervals: [] }];
    expect(status(weekly, "2026-11-21T02:00:00Z", "UTC", closed)).toMatchObject({
      isOpen: true,
      closesAt: "2026-11-21T06:00",
      exception: "Public holiday",
    });
    expect(status(weekly, "2026-11-21T10:00:00Z", "UTC", closed)).toMatchObject({
      isOpen: false,
      opensAt: "2026-11-23T08:00",
    });
  });

  it("special hours replace the weekly hours for that date", () => {
    const special = [
      {
        date: "2026-11-23",
        closed: false,
        label: "Stocktake",
        intervals: [{ opens: "10:00", closes: "14:00" }],
      },
    ];
    expect(status(weekly, "2026-11-23T09:00:00Z", "UTC", special)).toMatchObject({
      isOpen: false,
      opensAt: "2026-11-23T10:00",
    });
    expect(status(weekly, "2026-11-23T15:00:00Z", "UTC", special).isOpen).toBe(false);
  });
});

describe("schemas", () => {
  const week = (weekly: unknown) => branchHoursRequestSchema.safeParse({ timeZone: null, weekly });

  it("accepts a normal week, overnight intervals and all-day", () => {
    expect(
      week({
        mon: [{ opens: "08:00", closes: "17:00" }],
        fri: [{ opens: "22:00", closes: "06:00" }],
        sun: [{ opens: "00:00", closes: "24:00" }],
      }).success,
    ).toBe(true);
  });

  it.each([
    [
      "overlap",
      {
        mon: [
          { opens: "08:00", closes: "12:00" },
          { opens: "11:00", closes: "15:00" },
        ],
      },
    ],
    ["opens at 24:00", { mon: [{ opens: "24:00", closes: "02:00" }] }],
    ["same opening and closing", { mon: [{ opens: "08:00", closes: "08:00" }] }],
    ["invalid time", { mon: [{ opens: "25:00", closes: "26:00" }] }],
    ["unknown day", { someday: [] }],
    [
      "too many intervals",
      {
        mon: Array.from({ length: 5 }, (_, i) => ({
          opens: `0${String(i)}:00`,
          closes: `0${String(i)}:30`,
        })),
      },
    ],
  ])("rejects %s", (_name, weekly) => {
    expect(week(weekly).success).toBe(false);
  });

  it("rejects unknown time zones", () => {
    expect(
      branchHoursRequestSchema.safeParse({ timeZone: "Mars/Olympus", weekly: {} }).success,
    ).toBe(false);
    expect(
      branchHoursRequestSchema.safeParse({ timeZone: "Africa/Johannesburg", weekly: {} }).success,
    ).toBe(true);
  });

  it("exceptions are closed, or open with at least one interval", () => {
    expect(hoursExceptionRequestSchema.safeParse({ closed: true }).success).toBe(true);
    expect(hoursExceptionRequestSchema.safeParse({ closed: false, intervals: [] }).success).toBe(
      false,
    );
    expect(
      hoursExceptionRequestSchema.safeParse({
        closed: true,
        intervals: [{ opens: "08:00", closes: "09:00" }],
      }).success,
    ).toBe(false);
  });

  it("dates must be real calendar dates", () => {
    expect(localDateSchema.safeParse("2026-12-25").success).toBe(true);
    expect(localDateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(localDateSchema.safeParse("25/12/2026").success).toBe(false);
  });
});
